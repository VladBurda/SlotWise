import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { ProfileEditor } from '../src/features/business/BusinessSettings';
import { LocationEditor } from '../src/features/business/LocationEditor';
import {
  locationSchema,
  parseMinute,
  policiesSchema,
  type Profile,
} from '../src/features/business/contracts';
import type { Workspace } from '../src/features/account/api';

const workspace: Workspace = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Studio',
  slug: 'studio',
  timezone: 'Europe/Berlin',
  role: 'owner',
};
const profile: Profile = {
  version: 0,
  name: 'Studio',
  timezone: 'Europe/Berlin',
  description: '',
  phone: '',
  contact_email: null,
  policies: {
    minimum_notice_minutes: 60,
    booking_horizon_days: 90,
    cancellation_allowed: true,
    cancellation_notice_minutes: 1440,
    default_duration_minutes: 30,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    slot_interval_minutes: 15,
  },
};
function wrap(element: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {element}
    </QueryClientProvider>,
  );
}

test('invalid policy relationship prevents a save', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  wrap(
    <ProfileEditor
      initial={{
        ...profile,
        policies: {
          ...profile.policies,
          minimum_notice_minutes: 1440,
          booking_horizon_days: 1,
        },
      }}
      workspace={workspace}
      onSaved={vi.fn()}
    />,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Save business settings' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Minimum notice must be shorter',
  );
  expect(fetch).not.toHaveBeenCalled();
});
test('manager can review but cannot edit profile', () => {
  wrap(
    <ProfileEditor
      initial={profile}
      workspace={{ ...workspace, role: 'manager' }}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('Business name')).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Save business settings' }),
  ).not.toBeInTheDocument();
});
test('overlapping weekly rules are rejected before network mutation', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  wrap(
    <LocationEditor
      initial={{
        version: 0,
        name: 'Office',
        address: '',
        timezone: 'UTC',
        active: true,
        weekly: [
          { weekday: 0, start: 540, end: 720 },
          { weekday: 0, start: 660, end: 900 },
        ],
        exceptions: [],
      }}
      workspace={workspace}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save location' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'must not overlap',
  );
  expect(fetch).not.toHaveBeenCalled();
});
test('stale settings errors retain entered values', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/csrf')
              ? { csrf_token: 'a'.repeat(43) }
              : {
                  error: {
                    code: 'stale_settings',
                    message: 'Settings changed. Reload before saving.',
                  },
                },
          ),
          { status: url.endsWith('/csrf') ? 200 : 409 },
        ),
      ),
    ),
  );
  wrap(
    <ProfileEditor initial={profile} workspace={workspace} onSaved={vi.fn()} />,
  );
  await userEvent.clear(screen.getByLabelText('Business name'));
  await userEvent.type(
    screen.getByLabelText('Business name'),
    'My new business',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Save business settings' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Reload before saving',
  );
  expect(screen.getByLabelText('Business name')).toHaveValue('My new business');
});
test('clock and schedule validation rejects malformed and duplicate exceptions', () => {
  expect(parseMinute('24:00')).toBe(1440);
  expect(parseMinute('24:01')).toBeNaN();
  expect(
    policiesSchema.safeParse({ ...profile.policies, buffer_before_minutes: -1 })
      .success,
  ).toBe(false);
  expect(
    locationSchema.safeParse({
      version: 0,
      name: 'Studio',
      address: '',
      timezone: 'UTC',
      active: true,
      weekly: [],
      exceptions: [
        { day: '2026-02-30', kind: 'holiday', label: '', intervals: [] },
      ],
    }).success,
  ).toBe(false);
});
