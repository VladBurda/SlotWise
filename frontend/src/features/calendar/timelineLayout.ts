import type { Booking } from '@/features/bookings/contracts';
import { localDay } from '@/features/bookings/contracts';
import type { CatalogItem } from '@/features/catalog/contracts';
import { shiftDay } from './dates';

export type TimelineKind = 'staff' | 'resources';
export type DaySpan = { start: number; end: number };
export type PlacedBooking = {
  booking: Booking;
  start: number;
  end: number;
  lane: number;
  units: number;
  serviceStart: number;
  serviceEnd: number;
};
export type TimelineRow = {
  id: string;
  name: string;
  capacity?: number;
  active: boolean;
  entries: PlacedBooking[];
  lanes: number;
};

export function daySpan(day: string, timezone: string): DaySpan {
  // Find actual civil-date boundaries, including skipped midnights/dates. The
  // search works in epoch seconds; no guessed UTC offset or 24-hour day length.
  const boundary = (date: string) => {
    const center = Date.parse(`${date}T00:00:00Z`) / 1000;
    let low = center - 36 * 3600,
      high = center + 36 * 3600;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (localDay(new Date(middle * 1000).toISOString(), timezone) < date)
        low = middle;
      else high = middle;
    }
    return high * 1000;
  };
  return { start: boundary(day), end: boundary(shiftDay(day, 1)) };
}

export function axisTicks(span: DaySpan, timezone: string) {
  if (span.end <= span.start) return [];
  const ticks = [];
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  });
  for (
    let at = span.start;
    at <= span.end;
    at = Math.min(at + 3600000, span.end)
  ) {
    const parts = formatter.formatToParts(new Date(at));
    const part = (kind: string) =>
      parts.find((p) => p.type === kind)?.value ?? '';
    ticks.push({
      at,
      percent: (100 * (at - span.start)) / (span.end - span.start),
      time: `${part('hour')}:${part('minute')}`,
      offset: part('timeZoneName'),
    });
    if (at === span.end) break;
  }
  return ticks;
}

export function layoutBookings(
  bookings: { booking: Booking; units: number }[],
  span: DaySpan,
) {
  const clipped = bookings
    .map(({ booking, units }) => {
      const slot = booking.slot;
      const from =
        booking.status === 'confirmed' ? slot.occupied_from : slot.starts_at;
      const until =
        booking.status === 'confirmed' ? slot.occupied_until : slot.ends_at;
      return {
        booking,
        units,
        start: Math.max(Date.parse(from), span.start),
        end: Math.min(Date.parse(until), span.end),
        serviceStart: Math.max(Date.parse(slot.starts_at), span.start),
        serviceEnd: Math.min(Date.parse(slot.ends_at), span.end),
      };
    })
    .filter((entry) => entry.start < entry.end)
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        a.booking.id.localeCompare(b.booking.id),
    );
  const ends: number[] = [];
  const entries: PlacedBooking[] = clipped.map((entry) => {
    let lane = ends.findIndex((end) => end <= entry.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = entry.end;
    return { ...entry, lane };
  });
  return { entries, lanes: Math.max(1, ends.length) };
}

export function timelineRows(
  items: CatalogItem[],
  bookings: Booking[],
  kind: TimelineKind,
  span: DaySpan,
  locationId = '',
  selectedId = '',
): TimelineRow[] {
  const assignments = new Map<string, { booking: Booking; units: number }[]>();
  for (const booking of bookings) {
    if (locationId && booking.location_id !== locationId) continue;
    const ids =
      kind === 'staff'
        ? [{ id: booking.slot.employee_id, units: 1 }]
        : booking.slot.resources.map((r) => ({
            id: r.resource_id,
            units: r.unit_ids.length,
          }));
    for (const { id, units } of ids) {
      if (selectedId && id !== selectedId) continue;
      const entries = assignments.get(id) ?? [];
      entries.push({ booking, units });
      assignments.set(id, entries);
    }
  }
  const rows = new Map<string, TimelineRow>();
  for (const item of items) {
    const data = item.data;
    if (
      (data.kind !== 'staff' && data.kind !== 'resources') ||
      data.kind !== kind ||
      (locationId && data.location_id !== locationId) ||
      (selectedId && item.id !== selectedId)
    )
      continue;
    const layout = layoutBookings(assignments.get(item.id) ?? [], span);
    if (data.active || layout.entries.length || selectedId === item.id)
      rows.set(item.id, {
        id: item.id,
        name: data.name,
        capacity: data.capacity,
        active: data.active,
        ...layout,
      });
  }
  // Preserve historical assignments even if their current catalog location changed.
  for (const [id, assigned] of assignments) {
    if (rows.has(id)) continue;
    const layout = layoutBookings(assigned, span);
    if (!layout.entries.length) continue;
    const item = items.find((i) => i.id === id);
    rows.set(id, {
      id,
      name:
        item?.data.name ??
        `${kind === 'staff' ? 'Staff' : 'Resource'} ${id.slice(0, 8)}`,
      active: item?.data.active ?? false,
      ...layout,
    });
  }
  return [...rows.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}
