import { expect, type Page, test } from '@playwright/test';

async function openMenu(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /tap to start/i }).click();
  await expect(page.getByRole('button', { name: /salted chips/i })).toBeVisible();
}

test('confirm start-over clears the cart back to attract', async ({ page }) => {
  await openMenu(page);
  await page.getByRole('button', { name: /salted chips/i }).click();
  await expect(page.getByRole('complementary', { name: 'Your order' }).getByText('Salted chips')).toBeVisible();
  await page.locator('button.start-over').click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('heading', { name: 'Start over?' })).toBeVisible();
  await confirm.getByRole('button', { name: /^start over$/i }).click();
  await expect(page.getByRole('button', { name: /tap to start/i })).toBeVisible();
});
