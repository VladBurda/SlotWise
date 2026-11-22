import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { api } from '../src/features/account/api';
import { CalendarPage } from '../src/features/calendar/CalendarPage';
import {
  calendarDays,
  overlapsDay,
  rangeParams,
  shiftDay,
} from '../src/features/calendar/dates';
import type { Booking } from '../src/features/bookings/contracts';

vi.mock('../src/features/account/api', async (original) => ({
  ...(await original<typeof import('../src/features/account/api')>()),
  api: vi.fn(),
}));
test('calendar date arithmetic preserves civil days across DST and month boundaries', () => {
  expect(calendarDays('2026-03-29', 'week')).toEqual([
    '2026-03-23',
    '2026-03-24',
    '2026-03-25',
    '2026-03-26',
    '2026-03-27',
    '2026-03-28',
    '2026-03-29',
  ]);
  expect(shiftDay('2024-02-28', 1)).toBe('2024-02-29');
  const month = calendarDays('2026-11-30', 'month');
  expect(month).toHaveLength(42);
  expect(month[0]).toBe('2026-10-26');
  expect(calendarDays('', 'day')).toEqual([]);
  expect(calendarDays('2026-02-30', 'day')).toEqual([]);
  const range = rangeParams(calendarDays('2026-03-29', 'day'));
  expect(Date.parse(range.get('after')!)).toBeLessThan(
    Date.parse('2026-03-28T23:00:00Z'),
  );
  expect(Date.parse(range.get('before')!)).toBeGreaterThan(
    Date.parse('2026-03-29T22:00:00Z'),
  );
});
test('overnight appointments appear on both days but midnight end stays exclusive', () => {
  const booking = {
    slot: {
      starts_at: '2026-11-23T22:30:00Z',
      ends_at: '2026-11-24T00:30:00Z',
    },
  } as Booking;
  expect(overlapsDay(booking, '2026-11-23', 'Europe/Berlin')).toBe(true);
  expect(overlapsDay(booking, '2026-11-24', 'Europe/Berlin')).toBe(true);
  booking.slot.ends_at = '2026-11-23T23:00:00Z';
  expect(overlapsDay(booking, '2026-11-24', 'Europe/Berlin')).toBe(false);
});
test('filters issue scoped range queries and views update the day count', async () => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue([]);
  const id = '11111111-1111-4111-8111-111111111111';
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CalendarPage
        workspace={{
          id,
          name: 'Studio',
          slug: 'studio',
          role: 'owner',
          timezone: 'Europe/Berlin',
        }}
      />
    </QueryClientProvider>,
  );
  await screen.findByText(/0 appointments/);
  expect(screen.getAllByText('No appointments')).toHaveLength(7);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Calendar view'), 'day');
  await waitFor(() =>
    expect(screen.getAllByText('No appointments')).toHaveLength(1),
  );
  await user.selectOptions(
    screen.getByLabelText('Appointment status'),
    'cancelled',
  );
  await waitFor(() =>
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) => path.includes('status=cancelled')),
    ).toBe(true),
  );
  const request = vi
    .mocked(api)
    .mock.calls.find(([path]) => path.includes('/bookings?'))?.[0];
  expect(request).toContain(`/workspaces/${id}/bookings?`);
  expect(request).toContain('after=');
  expect(request).toContain('before=');
});
