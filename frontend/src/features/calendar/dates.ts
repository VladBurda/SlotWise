import type { Booking } from '@/features/bookings/contracts';
import { localDay } from '@/features/bookings/contracts';

export type CalendarView =
  'day' | 'week' | 'month' | 'agenda' | 'staff' | 'resources';
// Date arithmetic uses UTC noon for civil labels, never browser-local midnight.
export function shiftDay(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
export function calendarDays(day: string, view: CalendarView) {
  const date = new Date(`${day}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    return [];
  let start = day,
    count = 1;
  if (view === 'week' || view === 'agenda') {
    start = shiftDay(day, -(date.getUTCDay() + 6) % 7);
    count = 7;
  } else if (view === 'month') {
    const first = `${day.slice(0, 7)}-01`;
    start = shiftDay(
      first,
      -((new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7),
    );
    count = 42;
  }
  return Array.from({ length: count }, (_, index) => shiftDay(start, index));
}
export function overlapsDay(booking: Booking, day: string, timezone: string) {
  return (
    localDay(booking.slot.starts_at, timezone) <= day &&
    localDay(
      new Date(Date.parse(booking.slot.ends_at) - 1).toISOString(),
      timezone,
    ) >= day
  );
}
export function rangeParams(days: string[], includeBuffers = false) {
  // A generous UTC envelope covers all IANA offsets and DST. Display buckets use
  // exact civil dates; no ambiguous local-time-to-UTC conversion is necessary.
  const first = days[0],
    last = days.at(-1);
  if (!first || !last) throw new Error('Choose a valid calendar date.');
  return new URLSearchParams({
    after: new Date(
      Date.parse(`${first}T00:00:00Z`) - (includeBuffers ? 60 : 36) * 3600000,
    ).toISOString(),
    before: new Date(
      Date.parse(`${last}T00:00:00Z`) + (includeBuffers ? 84 : 60) * 3600000,
    ).toISOString(),
  });
}
export function dayTitle(day: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${day}T12:00:00Z`));
}
