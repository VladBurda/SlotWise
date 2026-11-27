import { z } from 'zod';
export const portalCatalog = z.object({
  name: z.string(),
  slug: z.string(),
  cancellation: z.object({ allowed: z.boolean(), notice_minutes: z.number() }),
  locations: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      address: z.string(),
      timezone: z.string(),
    }),
  ),
  services: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      description: z.string(),
      duration_minutes: z.number(),
      maximum_duration_minutes: z.number(),
      duration_step_minutes: z.number(),
      price_minor: z.number(),
      currency: z.string(),
      location_ids: z.array(z.string().uuid()),
    }),
  ),
  staff: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      location_id: z.string().uuid(),
    }),
  ),
});
export const customerBooking = z.object({
  id: z.string().uuid(),
  service_id: z.string().uuid(),
  location_id: z.string().uuid(),
  service_name: z.string(),
  customer_name: z.string(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  status: z.enum(['confirmed', 'cancelled']),
  version: z.number().int(),
  price_minor: z.number(),
  currency: z.string(),
});
export type CustomerBooking = z.infer<typeof customerBooking>;
export type PortalCatalog = z.infer<typeof portalCatalog>;
export const publicAvailability = z.object({
  timezone: z.string(),
  truncated: z.boolean(),
  slots: z.array(z.object({ starts_at: z.string(), ends_at: z.string() })),
});
