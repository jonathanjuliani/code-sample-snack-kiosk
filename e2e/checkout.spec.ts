import { expect, test } from '@playwright/test';

test('happy path: add an item, tap to pay, see a pickup number', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /tap anywhere/i }).click();
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('button', { name: /tap your card or phone/i }).click();
  await expect(page.getByText('Paid. Thank you!')).toBeVisible();
  await expect(page.locator('.ordno')).toHaveText(/^[A-Z]-\d{3}$/);
});

test('double tap on Pay creates one order', async ({ page }) => {
  const statuses: number[] = [];
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && response.url().includes('/orders')) {
      statuses.push(response.status());
    }
  });

  await page.goto('/?kiosk=e2e-double');
  await page.getByRole('button', { name: /tap anywhere/i }).click();
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  const pay = page.getByRole('button', { name: /tap your card or phone/i });
  await pay.click({ clickCount: 2, delay: 30 });
  await expect(page.getByText('Paid. Thank you!')).toBeVisible();
  expect(statuses.filter((code) => code === 201)).toHaveLength(1);
});
