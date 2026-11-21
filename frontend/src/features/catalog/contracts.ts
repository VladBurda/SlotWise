import { z } from 'zod';

const uuid = z.string().uuid();
const weekly = z.object({
  weekday: z.number().int().min(0).max(6),
  start: z.number().int().min(0).max(1439),
  end: z.number().int().min(1).max(1440),
});
const interval = weekly.omit({ weekday: true });
export const availabilitySchema = z.object({
  weekly: z.array(weekly).max(84),
  breaks: z.array(weekly).max(84),
  exceptions: z
    .array(
      z.object({
        day: z.string(),
        kind: z.enum(['holiday', 'special']),
        label: z.string().max(100),
        intervals: z.array(interval).max(12),
      }),
    )
    .max(366),
  unavailable: z
    .array(
      z.object({
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        reason: z.string().max(200),
      }),
    )
    .max(366),
});
const common = {
  version: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(100),
  active: z.boolean(),
};
const capacity = z.number().int().min(1).max(100);
const resourceType = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/)
  .max(50);
export const requirementSchema = z.object({
  resource_id: uuid.nullable(),
  pool_id: uuid.nullable(),
  resource_type: resourceType.nullable(),
  quantity: capacity,
  units_per_resource: capacity,
});
export const catalogSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('skills'),
    description: z.string().max(2000),
  }),
  z.object({
    ...common,
    kind: z.literal('staff'),
    location_id: uuid,
    title: z.string().max(100),
    capacity,
    qualifications: z
      .array(z.object({ skill_id: uuid, valid_until: z.string().nullable() }))
      .max(100),
    availability: availabilitySchema,
  }),
  z.object({
    ...common,
    kind: z.literal('resources'),
    location_id: uuid,
    resource_type: resourceType,
    capacity,
    attributes: z.record(z.string().max(100), z.string().max(500)),
    availability: availabilitySchema,
  }),
  z.object({
    ...common,
    kind: z.literal('pools'),
    location_id: uuid,
    resource_type: resourceType,
    resource_ids: z.array(uuid).max(100),
  }),
  z.object({
    ...common,
    kind: z.literal('services'),
    description: z.string().max(2000),
    duration_minutes: z.number().int().min(5).max(1440),
    maximum_duration_minutes: z.number().int().min(5).max(1440),
    duration_step_minutes: z.number().int().min(1).max(120),
    price_minor: z.number().int().min(0).max(100000000),
    currency: z.enum(['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'UAH']),
    buffer_before_minutes: z.number().int().min(0).max(1440),
    buffer_after_minutes: z.number().int().min(0).max(1440),
    minimum_notice_minutes: z.number().int().min(0).max(525600).nullable(),
    location_ids: z.array(uuid).min(1).max(100),
    skill_ids: z.array(uuid).max(100),
    employee_ids: z.array(uuid).max(100),
    compatible_resource_ids: z.array(uuid).max(100),
    requirements: z.array(requirementSchema).max(30),
  }),
]);
export const itemSchema = z.object({ id: uuid, data: catalogSchema });
export type CatalogData = z.infer<typeof catalogSchema>;
export type CatalogItem = z.infer<typeof itemSchema>;
export type Kind = CatalogData['kind'];
export type Availability = z.infer<typeof availabilitySchema>;
export const kinds: Kind[] = [
  'staff',
  'skills',
  'resources',
  'pools',
  'services',
];
export const titles: Record<Kind, string> = {
  staff: 'Staff',
  skills: 'Skills',
  resources: 'Resources',
  pools: 'Resource pools',
  services: 'Services',
};
export function newItem(kind: Kind, locationId: string): CatalogData {
  const base = { version: 0, name: '', active: true };
  const availability: Availability = {
    weekly: [],
    breaks: [],
    exceptions: [],
    unavailable: [],
  };
  switch (kind) {
    case 'skills':
      return { ...base, kind, description: '' };
    case 'staff':
      return {
        ...base,
        kind,
        location_id: locationId,
        title: '',
        capacity: 1,
        qualifications: [],
        availability,
      };
    case 'resources':
      return {
        ...base,
        kind,
        location_id: locationId,
        resource_type: 'room',
        capacity: 1,
        attributes: {},
        availability,
      };
    case 'pools':
      return {
        ...base,
        kind,
        location_id: locationId,
        resource_type: 'room',
        resource_ids: [],
      };
    case 'services':
      return {
        ...base,
        kind,
        description: '',
        duration_minutes: 30,
        maximum_duration_minutes: 30,
        duration_step_minutes: 5,
        price_minor: 0,
        currency: 'EUR',
        buffer_before_minutes: 0,
        buffer_after_minutes: 0,
        minimum_notice_minutes: null,
        location_ids: locationId ? [locationId] : [],
        skill_ids: [],
        employee_ids: [],
        compatible_resource_ids: [],
        requirements: [],
      };
  }
}

export function validateDraft(data: CatalogData): CatalogData {
  const parsed = catalogSchema.parse(data);
  if (parsed.kind === 'staff' || parsed.kind === 'resources') {
    for (const key of ['weekly', 'breaks'] as const) {
      for (let day = 0; day < 7; day++) {
        const rows = parsed.availability[key]
          .filter((r) => r.weekday === day)
          .sort((a, b) => a.start - b.start);
        if (
          rows.some(
            (r, i) =>
              r.start >= r.end || (i > 0 && (rows[i - 1]?.end ?? 0) > r.start),
          )
        )
          throw new Error(
            'Hours must be ordered without overlaps. Split overnight hours at midnight.',
          );
      }
    }
  }
  if (parsed.kind === 'services') {
    if (
      parsed.maximum_duration_minutes < parsed.duration_minutes ||
      (parsed.maximum_duration_minutes - parsed.duration_minutes) %
        parsed.duration_step_minutes
    )
      throw new Error(
        'Maximum duration must equal minimum plus whole duration steps.',
      );
    if (
      parsed.requirements.some(
        (r) =>
          [r.resource_id, r.pool_id, r.resource_type].filter(Boolean).length !==
          1,
      )
    )
      throw new Error('Choose one selector for each requirement.');
  }
  return parsed;
}
