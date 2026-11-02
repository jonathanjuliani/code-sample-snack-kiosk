import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const require = createRequire(path.join(process.cwd(), 'apps/api/package.json'));
const dbPath = path.join(process.cwd(), 'e2e', 'kiosk-e2e.db');

type Sqlite = {
  pragma: (source: string) => unknown;
  prepare: (source: string) => { run: (...args: unknown[]) => unknown };
  close: () => void;
};

const Database = require('better-sqlite3') as new (filename: string) => Sqlite;

function withDb(run: (db: Sqlite) => void) {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  try {
    run(db);
  } finally {
    db.close();
  }
}

function setPrice(itemId: string, cents: number) {
  withDb((db) => {
    db.prepare('UPDATE menu_items SET price_cents = ? WHERE id = ?').run(cents, itemId);
  });
}

function setAvailable(itemId: string, available: boolean) {
  withDb((db) => {
    db.prepare('UPDATE menu_items SET available = ? WHERE id = ?').run(available ? 1 : 0, itemId);
  });
}

test.afterEach(async ({ request }) => {
  setPrice('chips', 250);
  setAvailable('chips', true);
  const reset = await request.put('/api/ops/simulation', {
    data: {
      payment: 'follow-card',
      paymentsPaused: false,
      menuFails: false,
      priceBump: null,
      soldOut: null,
    },
  });
  expect(reset.ok()).toBeTruthy();
});

async function openMenu(page: Page, query = '/') {
  await page.goto(query);
  await page.getByRole('button', { name: /tap to start/i }).click();
  await expect(page.getByRole('button', { name: /salted chips/i })).toBeVisible();
}

async function typeCard(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
}

test('happy path pays by tap and returns to the attract screen', async ({ page }) => {
  await page.clock.install();
  await openMenu(page);
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /pretzels/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByText('Paid. Your order number is')).toBeVisible();
  await expect(page.locator('.ordno')).toHaveText(/^[A-Z]-\d{3}$/);
  await page.clock.fastForward(8_000);
  await expect(page.getByRole('button', { name: /tap to start/i })).toBeVisible();
});

test('happy path pays by mock tapzone', async ({ page }) => {
  await openMenu(page, '/?kiosk=e2e-tapzone');
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /simulate the reader/i }).click();
  await expect(page.getByText('Paid. Your order number is')).toBeVisible();
  await expect(page.locator('.ordno')).toHaveText(/^[A-Z]-\d{3}$/);
});

test('double tap on Pay creates one order', async ({ page }) => {
  const statuses: number[] = [];
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && response.url().includes('/orders')) {
      statuses.push(response.status());
    }
  });

  await openMenu(page, '/?kiosk=e2e-double');
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /^pay \$/i }).click({ clickCount: 2, delay: 30 });
  await expect(page.getByText('Paid. Your order number is')).toBeVisible();
  expect(statuses.filter((code) => code === 201)).toHaveLength(1);
});

test('a dropped submit after the server commits shows checking, then one order', async ({ page }) => {
  let dropped = false;
  let releaseLookup = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  await page.route('**/api/orders**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort();
      return;
    }
    if (request.method() === 'GET' && request.url().includes('idempotencyKey')) await gate;
    await route.continue();
  });

  await openMenu(page, '/?kiosk=e2e-drop');
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByText('Checking your payment…')).toBeVisible();
  releaseLookup();
  await expect(page.getByText('Paid. Your order number is')).toBeVisible();

  const summary = await (await page.request.get('/api/ops/summary')).json();
  const mine = (summary.orders as { kioskId: string }[]).filter((order) => order.kioskId === 'e2e-drop');
  expect(mine).toHaveLength(1);
});

test('a declined card keeps the order and another card pays it', async ({ page }) => {
  await openMenu(page);
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /enter card number/i }).click();
  await typeCard(page, '4000000000000002');
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByRole('heading', { name: 'Payment declined' })).toBeVisible();
  await expect(page.getByText('Salted chips')).toBeVisible();
  await page.getByRole('button', { name: /use another card/i }).click();
  await typeCard(page, '4242424242424242');
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByText('Card ending 4242')).toBeVisible();
});

test('idle countdown resets, and staying keeps the cart', async ({ page }) => {
  await page.clock.install();
  await openMenu(page, '/?idle=2');
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.clock.fastForward(2_500);
  await expect(page.getByRole('heading', { name: 'Are you still there?' })).toBeVisible();
  await page.getByRole('button', { name: /i'm still here/i }).click();
  await expect(page.getByRole('heading', { name: 'Are you still there?' })).toBeHidden();
  await expect(page.getByRole('complementary', { name: 'Your order' }).getByText('Salted chips')).toBeVisible();
  await page.clock.fastForward(2_500);
  await expect(page.getByRole('heading', { name: 'Are you still there?' })).toBeVisible();
  await page.clock.fastForward(10_500);
  await expect(page.getByRole('button', { name: /tap to start/i })).toBeVisible();
});

test('a price change is named before the new total is paid', async ({ page }) => {
  await openMenu(page, '/?kiosk=e2e-price');
  setPrice('chips', 400);
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByRole('heading', { name: 'Your total changed' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Salted chips/ })).toBeVisible();
  await page.getByRole('button', { name: /pay new total/i }).click();
  await expect(page.getByText('Paid. Your order number is')).toBeVisible();
  await expect(page.getByText('$4.00')).toBeVisible();
});

test('a sold-out item is disabled, and one that sells out is named', async ({ page }) => {
  await openMenu(page);
  await expect(page.getByRole('button', { name: /roasted peanuts/i })).toBeDisabled();
  await page.getByRole('button', { name: /salted chips/i }).click();
  setAvailable('chips', false);
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByRole('heading', { name: 'Your total changed' })).toBeVisible();
  await expect(page.getByText('Salted chips is sold out')).toBeVisible();
});

test('a failing menu shows a retry and then the items', async ({ page }) => {
  let allow = false;
  await page.route('**/api/menu', async (route) => {
    if (!allow) {
      await route.fulfill({ status: 500, body: '{}' });
      return;
    }
    await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: /tap to start/i }).click();
  await expect(page.getByRole('heading', { name: "We're having trouble loading the menu" })).toBeVisible();
  allow = true;
  await page.getByRole('button', { name: /try now/i }).click();
  await expect(page.getByRole('button', { name: /salted chips/i })).toBeVisible();
});

test('browsing works when payments are down, then pay comes back', async ({ page }) => {
  await openMenu(page);
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.context().setOffline(true);
  await expect(page.getByText("We can't take payments right now. You can keep browsing.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: /payments paused/i })).toBeDisabled();
  await page.getByRole('button', { name: /pretzels/i }).click();
  await expect(page.getByRole('complementary', { name: 'Your order' }).getByText('Pretzels')).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByRole('button', { name: /review and pay/i })).toBeEnabled({ timeout: 15_000 });
});

test('review stays disabled on an empty cart', async ({ page }) => {
  await openMenu(page);
  await expect(page.getByRole('button', { name: /review and pay/i })).toBeDisabled();
});

test('quantity stops at 10', async ({ page }) => {
  await openMenu(page);
  const chips = page.getByRole('button', { name: /salted chips/i });
  for (let i = 0; i < 10; i += 1) await chips.click();
  await expect(page.getByRole('button', { name: 'One more' })).toBeDisabled();
});

test('ops lists the order from a checkout', async ({ page }) => {
  await openMenu(page, '/?kiosk=e2e-ops');
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /^pay \$/i }).click();
  const pickup = (await page.locator('.ordno').textContent())?.trim() ?? '';
  await page.goto('/ops');
  const orderRow = page.getByRole('row', { name: new RegExp(pickup) }).filter({ hasText: 'e2e-ops' });
  await expect(orderRow).toBeVisible();
  await expect(orderRow.getByText('Paid')).toBeVisible();
  await expect(page.getByText('Duplicate submits absorbed')).toBeVisible();
});

test('the ops rail can decline a tap', async ({ page }) => {
  await page.goto('/ops');
  const payment = page.getByRole('combobox', { name: 'Next payment' });
  await expect(payment).toBeEnabled();
  const saved = page.waitForResponse(
    (res) => res.url().includes('/api/ops/simulation') && res.request().method() === 'PUT' && res.ok(),
  );
  await payment.selectOption('declined');
  await saved;
  await openMenu(page, '/?kiosk=e2e-sim');
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByRole('heading', { name: 'Payment declined' })).toBeVisible();
});
