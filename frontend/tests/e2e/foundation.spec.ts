import { expect, test } from '@playwright/test';
test('foundation loads and mobile navigation works', async ({
  page,
  isMobile,
}) => {
  await page.route('**/api/v1/health/ready', (route) =>
    route.fulfill({ json: { status: 'ready', database: true, redis: true } }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Connected', { exact: true })).toHaveCount(3);
  if (isMobile) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(
      page.getByRole('link', { name: 'Overview', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close menu' }).click();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
