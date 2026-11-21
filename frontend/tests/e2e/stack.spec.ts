import { expect, test } from '@playwright/test';

test.describe('real Compose stack', () => {
  test.skip(
    process.env.SLOTWISE_FULL_STACK !== '1',
    'Requires the built Compose stack',
  );

  test('serves the built UI and live dependency health through Nginx', async ({
    page,
    request,
  }) => {
    const ready = await request.get('/api/v1/health/ready');
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toEqual({
      status: 'ready',
      database: true,
      redis: true,
    });
    const response = await page.goto('/');
    expect(response?.headers()['content-security-policy']).toContain(
      "script-src 'self'",
    );
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(3);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Refresh', exact: true }),
    ).toBeEnabled();
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(3);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test('API documentation renders through the public proxy', async ({
    page,
  }) => {
    await page.goto('/api/docs');
    await expect(
      page.getByRole('heading', { name: /SlotWise API/ }),
    ).toBeVisible();
    await expect(
      page.getByText('/api/v1/health/ready', { exact: true }).first(),
    ).toBeVisible();
  });
});
