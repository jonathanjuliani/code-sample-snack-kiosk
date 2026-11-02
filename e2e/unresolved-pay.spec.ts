import { expect, type Page, test } from '@playwright/test';

async function openMenu(page: Page, query = '/') {
  await page.goto(query);
  await page.getByRole('button', { name: /tap to start/i }).click();
  await expect(page.getByRole('button', { name: /salted chips/i })).toBeVisible();
}

test.afterEach(async ({ request }) => {
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

test('an unresolved simulation shows the code dialog, then done starts a new order', async ({ page }) => {
  await page.clock.install();
  await page.goto('/ops');
  const payment = page.getByRole('combobox', { name: 'Next payment' });
  await expect(payment).toBeEnabled();
  const saved = page.waitForResponse(
    (res) => res.url().includes('/api/ops/simulation') && res.request().method() === 'PUT' && res.ok(),
  );
  await payment.selectOption('unresolved');
  await saved;

  await openMenu(page, '/?kiosk=e2e-unresolved');
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByRole('heading', { name: 'Checking your payment…' })).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(page.getByRole('heading', { name: "We couldn't confirm your payment" })).toBeVisible();
  await expect(page.locator('.code')).toBeVisible();
  await page.getByRole('button', { name: /start a new order/i }).click();
  await expect(page.getByRole('button', { name: /tap to start/i })).toBeVisible();
});
