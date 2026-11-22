import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import {
  axisTicks,
  daySpan,
  layoutBookings,
  timelineRows,
} from '../src/features/calendar/timelineLayout';
import { Timeline } from '../src/features/calendar/Timeline';
import { rangeParams } from '../src/features/calendar/dates';
import type { Booking } from '../src/features/bookings/contracts';
import { newItem, type CatalogItem } from '../src/features/catalog/contracts';

const id = '11111111-1111-4111-8111-111111111111';
const resourceId = '22222222-2222-4222-8222-222222222222';
function booking(key: string, start: string, end: string): Booking {
  return {
    id: key,
    service_id: id,
    location_id: id,
    customer_name: `Customer ${key}`,
    status: 'confirmed',
    version: 1,
    service_name: 'Consultation',
    price_minor: 0,
    currency: 'EUR',
    slot: {
      starts_at: start,
      ends_at: end,
      occupied_from: start,
      occupied_until: end,
      employee_id: id,
      employee_unit_id: id,
      resources: [{ resource_id: resourceId, unit_ids: [id, resourceId] }],
    },
  };
}
test.each([
  ['2026-03-29', 23],
  ['2026-10-25', 25],
  ['2026-11-23', 24],
])('uses actual elapsed day length for %s', (day, hours) => {
  const span = daySpan(day as string, 'Europe/Berlin');
  expect((span.end - span.start) / 3600000).toBe(hours);
});
test('the repeated hour has distinct ticks and offsets', () => {
  const ticks = axisTicks(
    daySpan('2026-10-25', 'Europe/Berlin'),
    'Europe/Berlin',
  );
  const repeated = ticks.filter((t) => t.time === '02:00');
  expect(repeated.map((t) => t.offset)).toEqual(['GMT+2', 'GMT+1']);
  expect(repeated[1]!.at - repeated[0]!.at).toBe(3600000);
});
test('handles non-hour zones and a skipped civil date', () => {
  const kathmandu = daySpan('2026-11-23', 'Asia/Kathmandu');
  expect(new Date(kathmandu.start).toISOString()).toBe(
    '2026-11-22T18:15:00.000Z',
  );
  const skipped = daySpan('2011-12-30', 'Pacific/Apia');
  expect(skipped.start).toBe(skipped.end);
  expect(axisTicks(skipped, 'Pacific/Apia')).toEqual([]);
});
test('separates overlapping buffered bookings and reuses lanes at exact adjacency', () => {
  const span = daySpan('2026-11-23', 'UTC');
  const a = booking('a', '2026-11-23T09:00:00Z', '2026-11-23T10:00:00Z');
  a.slot.occupied_until = '2026-11-23T10:15:00Z';
  const b = booking('b', '2026-11-23T10:00:00Z', '2026-11-23T11:00:00Z');
  const c = booking('c', '2026-11-23T10:15:00Z', '2026-11-23T10:30:00Z');
  const layout = layoutBookings(
    [c, b, a].map((value) => ({ booking: value, units: 1 })),
    span,
  );
  expect(layout.entries.map((e) => [e.booking.id, e.lane])).toEqual([
    ['a', 0],
    ['b', 1],
    ['c', 0],
  ]);
  expect(layout.lanes).toBe(2);
  a.status = 'cancelled';
  expect(
    layoutBookings(
      [a, b].map((value) => ({ booking: value, units: 1 })),
      span,
    ).lanes,
  ).toBe(1);
});
test('clips overnight and buffer-only spans and excludes boundary adjacency', () => {
  const span = daySpan('2026-11-23', 'UTC');
  const a = booking('a', '2026-11-22T23:30:00Z', '2026-11-23T00:00:00Z');
  expect(layoutBookings([{ booking: a, units: 1 }], span).entries).toEqual([]);
  a.slot.occupied_until = '2026-11-23T00:15:00Z';
  const placed = layoutBookings([{ booking: a, units: 1 }], span).entries[0]!;
  expect(placed.start).toBe(span.start);
  expect(placed.end - placed.start).toBe(15 * 60000);
  expect(placed.serviceEnd).toBe(span.start);
});
test('groups resource quantities, retains history and filters row selections', () => {
  const b = booking('a', '2026-11-23T09:00:00Z', '2026-11-23T10:00:00Z');
  const items: CatalogItem[] = [
    { id, data: { ...newItem('staff', id), name: 'Alex' } },
    {
      id: resourceId,
      data: { ...newItem('resources', id), name: 'Room', active: false },
    },
  ];
  const rows = timelineRows(
    items,
    [b],
    'resources',
    daySpan('2026-11-23', 'UTC'),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.entries[0]!.units).toBe(2);
  expect(rows[0]!.active).toBe(false);
  expect(
    timelineRows(items, [b], 'resources', daySpan('2026-11-23', 'UTC'), '', id),
  ).toEqual([]);
  expect(
    timelineRows([], [b], 'staff', daySpan('2026-11-23', 'UTC'))[0]!.entries,
  ).toHaveLength(1);
});
test('timeline fetch envelopes include maximum buffers in extreme timezones', () => {
  const b = booking('a', '2026-11-21T10:00:00Z', '2026-11-21T11:00:00Z');
  b.slot.occupied_until = '2026-11-22T11:00:00Z';
  const span = daySpan('2026-11-23', 'Pacific/Kiritimati');
  expect(layoutBookings([{ booking: b, units: 1 }], span).entries).toHaveLength(
    1,
  );
  const range = rangeParams(['2026-11-23'], true);
  expect(Date.parse(b.slot.ends_at)).toBeGreaterThan(
    Date.parse(range.get('after')!),
  );
});
test('timeline and its readable list open the same booking details', async () => {
  const b = booking('a', '2026-11-23T09:00:00Z', '2026-11-23T09:05:00Z');
  const onSelect = vi.fn();
  render(
    <Timeline
      day="2026-11-23"
      timezone="UTC"
      kind="staff"
      items={[{ id, data: { ...newItem('staff', id), name: 'Alex' } }]}
      bookings={[b]}
      locationId=""
      selectedId=""
      onSelect={onSelect}
    />,
  );
  expect(
    screen.getByRole('region', { name: 'Staff timeline' }),
  ).toHaveAttribute('tabindex', '0');
  expect(
    screen.getByText(/Empty space does not mean bookable/),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(
    within(screen.getByRole('region', { name: 'Staff timeline' })).getByRole(
      'button',
      { name: /Customer a.*Consultation/ },
    ),
  );
  expect(onSelect).toHaveBeenLastCalledWith('a');
  await user.click(screen.getByText('Appointment list for displayed rows (1)'));
  const buttons = screen.getAllByRole('button', {
    name: /Customer a.*Consultation/,
  });
  await user.click(buttons[1]!);
  expect(onSelect).toHaveBeenCalledTimes(2);
});
