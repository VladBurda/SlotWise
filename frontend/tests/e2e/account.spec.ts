import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { z } from 'zod';

const password = 'Browser-test-password-42';
async function emailLink(
  request: APIRequestContext,
  email: string,
  subject: string,
): Promise<string> {
  let id = '';
  await expect
    .poll(
      async () => {
        const result = await request.get(
          `http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${email} subject:"${subject}"`)}`,
        );
        const list = z
          .object({ messages: z.array(z.object({ ID: z.string() })) })
          .parse(await result.json());
        id = list.messages[0]?.ID ?? '';
        return id;
      },
      { timeout: 30000, intervals: [500, 1000] },
    )
    .not.toBe('');
  const result = await request.get(
    `http://127.0.0.1:8025/api/v1/message/${id}`,
  );
  const mail = z.object({ Text: z.string() }).parse(await result.json());
  const match = mail.Text.match(/http:\/\/localhost:5173(\/account\/[^\s]+)/);
  if (!match?.[1]) throw new Error('Expected local account link in email');
  return match[1];
}
async function registerAndVerify(
  page: Page,
  request: APIRequestContext,
  email: string,
) {
  await page.goto('/account/register');
  await page.getByLabel('Your name').fill('Browser Test');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('verification email');
  await page.goto(await emailLink(request, email, 'Verify'));
  await page.getByRole('button', { name: 'Verify email' }).click();
  await expect(page.getByRole('status')).toContainText('Email verified');
}
async function login(page: Page, email: string, value = password) {
  await page.goto('/account/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app/);
}

test('configure staff, assets and services with qualified matches', async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(
    process.env.SLOTWISE_FULL_STACK !== '1',
    'Requires real Compose stack',
  );
  test.setTimeout(120000);
  page.on('dialog', (dialog) => dialog.accept());
  const run = randomUUID().slice(0, 8);
  const email = `catalog-${run}@example.com`;
  await registerAndVerify(page, request, email);
  await login(page, email);
  await page
    .getByLabel('Workspace name', { exact: true })
    .fill(`Workshop ${run}`);
  await page.getByLabel('Workspace address').fill(`catalog-${run}`);
  await page
    .getByRole('button', { name: 'Create workspace', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Business settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await page.getByLabel('Location name', { exact: true }).fill('Main workshop');
  await page
    .getByRole('button', { name: 'Add monday interval', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Save location', exact: true })
    .click();
  await expect(
    page.getByText('Location saved.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Scheduling setup', exact: true })
    .click();

  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('button', { name: 'Add skills', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Diagnostics');
  await page.getByRole('button', { name: 'Save skills', exact: true }).click();
  await expect(
    page.getByText('Diagnostics saved.', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Staff', exact: true }).click();
  await page.getByRole('button', { name: 'Add staff', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Alex Morgan');
  await page
    .getByLabel('Job title', { exact: true })
    .fill('Diagnostic technician');
  await page
    .getByRole('group', { name: 'Qualifications', exact: true })
    .getByLabel('Diagnostics', { exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Add working hours', exact: true })
    .click();
  await page.getByLabel('weekly start 1', { exact: true }).fill('08:30');
  await page.getByRole('button', { name: 'Add break', exact: true }).click();
  await page.getByRole('button', { name: 'Save staff', exact: true }).click();
  await expect(
    page.getByText('Alex Morgan saved.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Check date', { exact: true }).fill('2026-11-23');
  await page
    .getByRole('button', { name: 'Preview seven days', exact: true })
    .click();
  await expect(
    page.getByText('Location time zone: Europe/Berlin', { exact: true }),
  ).toBeVisible();
  if (process.env.SLOTWISE_CAPTURE === '1')
    await page.screenshot({
      path: `../docs/screenshots/staff-${isMobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });

  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add resources', exact: true })
    .click();
  await page.getByLabel('Name', { exact: true }).fill('Diagnostic room');
  await page.getByLabel('Capacity', { exact: false }).fill('2');
  await page
    .getByRole('button', { name: 'Add working hours', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Save resources', exact: true })
    .click();
  await expect(
    page.getByText('Diagnostic room saved.', { exact: true }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Resource pools', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add resource pools', exact: true })
    .click();
  await page.getByLabel('Name', { exact: true }).fill('Diagnostic rooms');
  await page.getByLabel('Diagnostic room', { exact: true }).check();
  await page
    .getByRole('button', { name: 'Save resource pools', exact: true })
    .click();
  await expect(
    page.getByText('Diagnostic rooms saved.', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Services', exact: true }).click();
  await page.getByRole('button', { name: 'Add services', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Vehicle diagnostics');
  await page
    .getByLabel('Maximum duration (minutes)', { exact: true })
    .fill('60');
  await page
    .getByRole('group', {
      name: 'Required skills (all must match)',
      exact: true,
    })
    .getByLabel('Diagnostics', { exact: true })
    .check();
  await page
    .getByRole('group', {
      name: 'Eligible staff (empty means all qualified staff)',
      exact: true,
    })
    .getByLabel('Alex Morgan', { exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Add resource requirement', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Requirement selector', exact: true })
    .selectOption('pool');
  await page
    .getByRole('combobox', { name: 'Required pool', exact: true })
    .selectOption({ label: 'Diagnostic rooms' });
  await page.getByLabel('Units per asset', { exact: true }).fill('2');
  await page
    .getByRole('button', { name: 'Save services', exact: true })
    .click();
  await expect(
    page.getByText('Vehicle diagnostics saved.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole('button', { name: 'Scheduling setup', exact: true })
    .click();
  await page.getByRole('button', { name: 'Services', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit Vehicle diagnostics', exact: true })
    .click();
  await expect(
    page.getByLabel('Maximum duration (minutes)', { exact: true }),
  ).toHaveValue('60');
  await page.getByLabel('Check date', { exact: true }).fill('2026-11-23');
  await page
    .getByRole('button', { name: 'Check staff and resources', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Qualified staff', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Qualified staff' }),
  ).toContainText('Alex Morgan');
  await expect(
    page.getByRole('status').filter({ hasText: 'Qualified staff' }),
  ).toContainText('Diagnostic room');
  if (process.env.SLOTWISE_CAPTURE === '1')
    await page.screenshot({
      path: `../docs/screenshots/service-${isMobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });

  await page.getByRole('button', { name: 'Appointments', exact: true }).click();
  await page
    .getByRole('button', { name: 'New appointment', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Service', exact: true })
    .selectOption({ label: 'Vehicle diagnostics' });
  await page
    .getByRole('combobox', { name: 'Location', exact: true })
    .selectOption({ label: 'Main workshop' });
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() + 8);
  while (monday.getUTCDay() !== 1) monday.setUTCDate(monday.getUTCDate() + 1);
  await page
    .getByLabel('Date at location')
    .fill(monday.toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Find available times' }).click();
  await page
    .getByRole('group', { name: 'Available times' })
    .getByRole('button')
    .first()
    .click();
  await page.getByLabel('Customer name').fill('Jamie Taylor');
  if (process.env.SLOTWISE_BOOKING_CAPTURE === '1')
    await page.screenshot({
      path: `../docs/screenshots/booking-editor-${isMobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
  await page
    .getByRole('button', { name: 'Confirm booking', exact: true })
    .click();
  await expect(
    page.getByText('Appointment confirmed for Jamie Taylor.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Appointments', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Jamie Taylor' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await page.getByRole('button', { name: 'Find available times' }).click();
  await page
    .getByRole('group', { name: 'Available times' })
    .getByRole('button')
    .nth(1)
    .click();
  await page.getByRole('button', { name: 'Confirm reschedule' }).click();
  await expect(
    page.getByText('Appointment confirmed for Jamie Taylor.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Cancel appointment', exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(
    page.getByText('Appointment cancelled.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('cancelled', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (process.env.SLOTWISE_BOOKING_CAPTURE === '1')
    await page.screenshot({
      path: `../docs/screenshots/bookings-${isMobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page
    .getByLabel('Calendar date')
    .fill(monday.toISOString().slice(0, 10));
  await expect(page.getByText(/0 appointments/)).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Appointment status', exact: true })
    .selectOption('cancelled');
  await page
    .getByRole('combobox', { name: 'Calendar location', exact: true })
    .selectOption({ label: 'Main workshop' });
  await page
    .getByRole('combobox', { name: 'Calendar staff', exact: true })
    .selectOption({ label: 'Alex Morgan' });
  await page
    .getByRole('combobox', { name: 'Calendar resource', exact: true })
    .selectOption({ label: 'Diagnostic room' });
  await expect(page.getByText(/1 appointments/)).toBeVisible();
  await page
    .getByRole('button', { name: /Jamie Taylor Vehicle diagnostics/ })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Appointment details' }),
  ).toContainText('Alex Morgan');
  await page.getByRole('button', { name: 'Close details' }).click();
  if (process.env.SLOTWISE_CALENDAR_CAPTURE === '1')
    await page.screenshot({
      path: `../docs/screenshots/calendar-week-${isMobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
  for (const view of ['day', 'month', 'agenda']) {
    await page
      .getByRole('combobox', { name: 'Calendar view', exact: true })
      .selectOption(view);
    await expect(page.getByText(/1 appointments/)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Next period' }).click();
  await expect(page.getByText(/0 appointments/)).toBeVisible();
  await page.getByRole('button', { name: 'Previous period' }).click();
  await expect(page.getByText(/1 appointments/)).toBeVisible();
  for (const view of ['staff', 'resources']) {
    await page
      .getByRole('combobox', { name: 'Calendar view', exact: true })
      .selectOption(view);
    const timeline = page.getByRole('region', {
      name: view === 'staff' ? 'Staff timeline' : 'Resource timeline',
      exact: true,
    });
    await expect(timeline).toBeVisible();
    await timeline
      .getByRole('button', { name: /Jamie Taylor.*Vehicle diagnostics/ })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Appointment details' }),
    ).toContainText('Jamie Taylor');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Appointment details' }),
    ).toBeHidden();
    if (process.env.SLOTWISE_TIMELINE_CAPTURE === '1')
      await page.screenshot({
        path: `../docs/screenshots/timeline-${view}-${isMobile ? 'mobile' : 'desktop'}.png`,
        fullPage: true,
      });
    await page.getByRole('button', { name: 'Next period' }).click();
    await expect(
      timeline.getByRole('button', { name: /Jamie Taylor/ }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Previous period' }).click();
    await expect(
      timeline.getByRole('button', { name: /Jamie Taylor/ }),
    ).toHaveCount(1);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test.describe('account lifecycle against PostgreSQL and Mailpit', () => {
  test.skip(
    process.env.SLOTWISE_FULL_STACK !== '1',
    'Requires real Compose stack',
  );
  test('owner onboarding, invitation, role change, switching and password reset', async ({
    page,
    request,
    browser,
    isMobile,
  }) => {
    test.setTimeout(120000);
    const run = randomUUID().slice(0, 8);
    const owner = `owner-${run}@example.com`,
      employee = `employee-${run}@example.com`;
    if (process.env.SLOTWISE_CAPTURE === '1') {
      await page.goto('/account/login');
      await page.screenshot({
        path: `../docs/screenshots/login-${isMobile ? 'mobile' : 'desktop'}.png`,
        fullPage: true,
      });
    }
    await registerAndVerify(page, request, owner);
    await login(page, owner);
    await page
      .getByLabel('Workspace name', { exact: true })
      .fill(`Studio ${run}`);
    await page.getByLabel('Workspace address').fill(`studio-${run}`);
    await page
      .getByRole('button', { name: 'Create workspace', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: `Studio ${run}` }),
    ).toBeVisible();
    await page.getByLabel('Teammate email').fill(employee);
    await page
      .getByRole('combobox', { name: 'Workspace role', exact: true })
      .selectOption('employee');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByRole('status')).toContainText('Invitation queued');
    const invitation = await emailLink(request, employee, 'invitation');
    const teammateContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:5173',
    });
    try {
      const teammate = await teammateContext.newPage();
      await registerAndVerify(teammate, request, employee);
      await login(teammate, employee);
      await teammate.goto(`http://127.0.0.1:5173${invitation}`);
      await teammate.getByRole('button', { name: 'Accept invitation' }).click();
      await expect(
        teammate.getByRole('heading', { name: `Studio ${run}` }),
      ).toBeVisible();
      await expect(
        teammate.getByText('Your employee membership is active.', {
          exact: false,
        }),
      ).toBeVisible();
      await expect(
        teammate.getByRole('button', { name: 'Send invitation' }),
      ).toHaveCount(0);
      await page.reload();
      const member = page
        .getByRole('listitem')
        .filter({ has: page.getByText(employee, { exact: true }) })
        .filter({ has: page.getByRole('button', { name: 'Save role' }) });
      await member.getByLabel(`Role for ${employee}`).selectOption('manager');
      await member.getByRole('button', { name: 'Save role' }).click();
      await expect(
        member.getByRole('button', { name: 'Save role' }),
      ).toBeDisabled();
      await teammate.reload();
      await expect(
        teammate.getByRole('heading', { name: 'Your team' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'New workspace' }).click();
      await page
        .getByLabel('Workspace name', { exact: true })
        .fill(`Second ${run}`);
      await page.getByLabel('Workspace address').fill(`second-${run}`);
      await page
        .getByRole('button', { name: 'Create workspace', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: `Second ${run}` }),
      ).toBeVisible();
      await page
        .getByLabel('Current workspace')
        .selectOption({ label: `Studio ${run}` });
      await expect(
        page.getByRole('heading', { name: `Studio ${run}` }),
      ).toBeVisible();
      await teammate.goto('/account/forgot');
      await teammate.getByLabel('Email address').fill(employee);
      await teammate.getByRole('button', { name: 'Send reset link' }).click();
      await teammate.goto(await emailLink(request, employee, 'Reset'));
      await teammate
        .getByLabel('Password', { exact: true })
        .fill(password + '-new');
      await teammate.getByRole('button', { name: 'Update password' }).click();
      await expect(teammate.getByRole('status')).toContainText(
        'Password updated',
      );
      await login(teammate, employee, password + '-new');
      await teammate.getByRole('button', { name: 'Sign out' }).click();
      await expect(teammate).toHaveURL(/\/account\/login/);
      await teammate.goto('/app');
      await expect(teammate).toHaveURL(/\/account\/login/);
    } finally {
      await teammateContext.close();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (process.env.SLOTWISE_CAPTURE === '1') {
      await page.screenshot({
        path: `../docs/screenshots/workspace-${isMobile ? 'mobile' : 'desktop'}.png`,
        fullPage: true,
      });
    }
  });
});

test('business settings persist hours, exceptions and DST previews', async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(
    process.env.SLOTWISE_FULL_STACK !== '1',
    'Requires real Compose stack',
  );
  test.setTimeout(120000);
  const run = randomUUID().slice(0, 8);
  const email = `settings-${run}@example.com`;
  await registerAndVerify(page, request, email);
  await login(page, email);
  await page
    .getByLabel('Workspace name', { exact: true })
    .fill(`Business ${run}`);
  await page.getByLabel('Workspace address').fill(`business-${run}`);
  await page
    .getByRole('button', { name: 'Create workspace', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Business settings', exact: true })
    .click();
  await page
    .getByLabel('Business name', { exact: true })
    .fill(`Configured ${run}`);
  await page.getByLabel('Contact email').fill(`contact-${run}@example.com`);
  await page
    .getByLabel('Preparation buffer (minutes)', { exact: true })
    .fill('10');
  await page.getByRole('button', { name: 'Save business settings' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Business settings saved',
  );
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await page.getByLabel('Location name', { exact: true }).fill('Berlin studio');
  await page
    .getByLabel('Location time zone', { exact: true })
    .fill('Europe/Berlin');
  await page
    .getByRole('button', { name: 'Add sunday interval', exact: true })
    .click();
  await page.getByLabel('Sunday start 1', { exact: true }).fill('00:00');
  await page.getByLabel('Sunday end 1', { exact: true }).fill('04:00');
  await page.getByRole('button', { name: 'Add dated exception' }).click();
  await page.getByLabel('Exception date 1', { exact: true }).fill('2026-12-27');
  await page
    .getByLabel('Exception label 1', { exact: true })
    .fill('Winter holiday');
  await page.getByRole('button', { name: 'Add dated exception' }).click();
  await page.getByLabel('Exception date 2', { exact: true }).fill('2026-12-20');
  await page
    .getByRole('combobox', { name: 'Exception type 2', exact: true })
    .selectOption('special');
  await page.getByLabel('Exception 2 start 1', { exact: true }).fill('10:00');
  await page.getByLabel('Exception 2 end 1', { exact: true }).fill('12:00');
  await page
    .getByRole('button', { name: 'Save location', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Saved operating-hours preview' }),
  ).toBeVisible();
  await page.getByLabel('Preview from').fill('2026-03-29');
  await expect(page.locator('.operating-preview')).toContainText('00:00 GMT+1');
  await expect(page.locator('.operating-preview')).toContainText('04:00 GMT+2');
  await page.getByLabel('Preview from').fill('2026-10-25');
  await expect(page.locator('.operating-preview')).toContainText('00:00 GMT+2');
  await expect(page.locator('.operating-preview')).toContainText('04:00 GMT+1');
  await page.reload();
  await page
    .getByRole('button', { name: 'Business settings', exact: true })
    .click();
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue(
    `Configured ${run}`,
  );
  await expect(
    page.getByLabel('Preparation buffer (minutes)', { exact: true }),
  ).toHaveValue('10');
  await page
    .getByRole('button', { name: 'Open Berlin studio', exact: true })
    .click();
  await page.getByLabel('Preview from').fill('2026-12-27');
  await expect(page.locator('.operating-preview')).toContainText(
    'Winter holiday',
  );
  await page.getByLabel('Preview from').fill('2026-12-20');
  await expect(page.locator('.operating-preview')).toContainText('10:00 GMT+1');
  await page.getByLabel('Location is active').uncheck();
  await page
    .getByRole('button', { name: 'Save location', exact: true })
    .click();
  await expect(page.locator('.operating-preview')).toContainText('inactive');
  await page.getByLabel('Location is active').check();
  await page
    .getByRole('button', { name: 'Save location', exact: true })
    .click();
  await expect(page.locator('.operating-preview li').first()).toContainText(
    'special',
  );
  await expect(page.locator('.location-list')).toContainText(
    'Europe/Berlin · Active',
  );
  if (process.env.SLOTWISE_CAPTURE === '1') {
    await page.screenshot({
      path: `../docs/screenshots/settings-${isMobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    await page.locator('.operating-preview').screenshot({
      path: `../docs/screenshots/hours-preview-${isMobile ? 'mobile' : 'desktop'}.png`,
    });
  }
});
