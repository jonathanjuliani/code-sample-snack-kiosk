import { expect, type Page, test } from '@playwright/test';

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

async function declineOnce(page: Page) {
  await page.getByRole('button', { name: /enter card number/i }).click();
  await typeCard(page, '4000000000000002');
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByRole('heading', { name: 'Payment declined' })).toBeVisible();
}

test('two declines open staff assist and ops lists the request', async ({ page }) => {
  await openMenu(page, '/?kiosk=e2e-assist');
  await page.getByRole('button', { name: /salted chips/i }).click();
  await page.getByRole('button', { name: /review and pay/i }).click();
  await declineOnce(page);
  await page.getByRole('button', { name: /use another card/i }).click();
  await typeCard(page, '4000000000000002');
  await page.getByRole('button', { name: /^pay \$/i }).click();
  await expect(page.getByRole('heading', { name: 'Payment declined' })).toBeVisible();
  await page.getByRole('button', { name: /get staff help/i }).click();
  await expect(page.getByRole('heading', { name: 'Help is on the way' })).toBeVisible();
  await page.getByRole('button', { name: /ok, i'll wait/i }).click();
  await expect(page.getByRole('heading', { name: 'Help is on the way' })).toBeHidden();
  await expect(page.getByRole('button', { name: /staff assist/i })).toBeVisible();

  await page.goto('/ops');
  const assistSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Staff assist' }) });
  await expect(assistSection.getByRole('cell', { name: 'e2e-assist' })).toBeVisible();
});
