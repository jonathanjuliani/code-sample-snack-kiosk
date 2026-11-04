import { expect, type Page, type Route, test } from '@playwright/test';

async function openMenu(page: Page, query: string) {
  await page.goto(query);
  await page.getByRole('button', { name: /tap to start/i }).click();
  await expect(page.getByRole('button', { name: /salted chips/i })).toBeVisible();
}

async function typeCard(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
}

test.afterEach(async ({ request }) => {
  const reset = await request.put('/api/ops/simulation', {
    data: { payment: 'follow-card', paymentsPaused: false, menuFails: false, priceBump: null, soldOut: null },
  });
  expect(reset.ok()).toBeTruthy();
});

test('a reload while a payment never resolves still reaches the counter code', async ({ page }) => {
  await page.clock.install();
  const saved = await page.request.put('/api/ops/simulation', {
    data: { payment: 'unresolved', paymentsPaused: false, menuFails: false, priceBump: null, soldOut: null },
  });
  expect(saved.ok()).toBeTruthy();

  await openMenu(page, '/?kiosk=e2e-reload-unresolved');
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByRole('heading', { name: 'Checking your payment…' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Checking your payment…' })).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(page.getByRole('heading', { name: "We couldn't confirm your payment" })).toBeVisible();
});

test('a reload before a card payment lands goes back to Pay and sends nothing', async ({ page }) => {
  const held: Route[] = [];
  let postsAfterReload = 0;
  let reloaded = false;
  await page.route('**/api/orders**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (reloaded) postsAfterReload += 1;
    held.push(route); // never reaches the API
  });

  await openMenu(page, '/?kiosk=e2e-reload-lost');
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /enter card number/i }).click();
  await typeCard(page, '4242424242424242');
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByRole('heading', { name: 'Processing payment…' })).toBeVisible();

  reloaded = true;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Checking your payment…' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Checking your payment…' })).toBeHidden({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'How would you like to pay?' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Your order' }).getByText('Salted chips')).toBeVisible();
  expect(postsAfterReload).toBe(0);

  const summary = await (await page.request.get('/api/ops/summary')).json();
  const mine = (summary.orders as { kioskId: string }[]).filter((order) => order.kioskId === 'e2e-reload-lost');
  expect(mine).toHaveLength(0);

  await Promise.all(held.map((route) => route.abort().catch(() => {})));
});
