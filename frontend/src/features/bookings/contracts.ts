import { z } from 'zod';

const uuid = z.string().uuid();
export const slotSchema = z.object({
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  occupied_from: z.string().datetime({ offset: true }),
  occupied_until: z.string().datetime({ offset: true }),
  employee_id: uuid,
  employee_unit_id: uuid,
  resources: z.array(z.object({ resource_id: uuid, unit_ids: z.array(uuid) })),
});
export const availabilitySchema = z.object({
  timezone: z.string(),
  computed_at: z.string(),
  slots: z.array(slotSchema),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
  reservation_aware: z.boolean(),
});
export const bookingSchema = z.object({
  id: uuid,
  service_id: uuid,
  location_id: uuid,
  customer_name: z.string(),
  status: z.enum(['confirmed', 'cancelled']),
  version: z.number().int(),
  slot: slotSchema,
  service_name: z.string(),
  price_minor: z.number(),
  currency: z.string(),
});
export type Booking = z.infer<typeof bookingSchema>;
export type Slot = z.infer<typeof slotSchema>;
export function localDay(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  return ['year', 'month', 'day']
    .map((key) => parts.find((p) => p.type === key)?.value)
    .join('-');
}
export function slotLabel(instant: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'shortOffset',
  }).format(new Date(instant));
}
