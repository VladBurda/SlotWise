import { z } from 'zod';

export const policiesSchema = z
  .object({
    minimum_notice_minutes: z.number().int().min(0).max(525600),
    booking_horizon_days: z.number().int().min(1).max(365),
    cancellation_allowed: z.boolean(),
    cancellation_notice_minutes: z.number().int().min(0).max(525600),
    default_duration_minutes: z.number().int().min(5).max(1440),
    buffer_before_minutes: z.number().int().min(0).max(1440),
    buffer_after_minutes: z.number().int().min(0).max(1440),
    slot_interval_minutes: z.number().int().min(1).max(120),
  })
  .refine(
    (p) => p.minimum_notice_minutes < p.booking_horizon_days * 1440,
    'Minimum notice must be shorter than the booking horizon.',
  );
export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Enter an IANA time zone such as Europe/Berlin.');
export const profileSchema = z.object({
  version: z.number().int(),
  name: z.string().trim().min(1).max(100),
  timezone: timezoneSchema,
  description: z.string().max(2000),
  contact_email: z.string().email().nullable(),
  phone: z.string().max(50),
  policies: policiesSchema,
});
export type Profile = z.infer<typeof profileSchema>;
const intervalSchema = z.object({
  start: z.number().int().min(0).max(1439),
  end: z.number().int().min(1).max(1440),
});
export type Interval = z.infer<typeof intervalSchema>;
export const locationSchema = z
  .object({
    id: z.string().uuid().optional(),
    version: z.number().int(),
    name: z.string().trim().min(1).max(100),
    address: z.string().max(500),
    timezone: timezoneSchema,
    active: z.boolean(),
    weekly: z
      .array(intervalSchema.extend({ weekday: z.number().int().min(0).max(6) }))
      .max(84),
    exceptions: z
      .array(
        z.object({
          day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          kind: z.enum(['holiday', 'special']),
          label: z.string().max(100),
          intervals: z.array(intervalSchema).max(12),
        }),
      )
      .max(366),
  })
  .superRefine((data, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: 'custom', message });
    const check = (items: Interval[]) => {
      if (items.some((i) => i.start >= i.end))
        issue('Start must precede end. Split overnight hours at midnight.');
      const ordered = [...items].sort((a, b) => a.start - b.start);
      if (
        ordered.some(
          (item, index) =>
            index > 0 && (ordered[index - 1]?.end ?? 0) > item.start,
        )
      )
        issue('Operating intervals must not overlap.');
    };
    for (let day = 0; day < 7; day++)
      check(data.weekly.filter((i) => i.weekday === day));
    if (
      new Set(data.exceptions.map((e) => e.day)).size !== data.exceptions.length
    )
      issue('Only one exception is allowed per date.');
    for (const e of data.exceptions) {
      check(e.intervals);
      if (e.kind === 'holiday' && e.intervals.length)
        issue('Holidays must have no operating intervals.');
      if (e.kind === 'special' && !e.intervals.length)
        issue('Special hours require an interval.');
      const parsed = new Date(e.day + 'T00:00:00Z');
      if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== e.day ||
        e.day < '1900-01-01' ||
        e.day > '2100-12-31'
      )
        issue('Enter a valid date between 1900 and 2100.');
    }
  });
export type Location = z.infer<typeof locationSchema>;
export const previewSchema = z.array(
  z.object({
    day: z.string(),
    source: z.string(),
    label: z.string(),
    issue: z.string().nullable(),
    intervals: z.array(z.object({ start: z.string(), end: z.string() })),
  }),
);
export const weekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
export function formatMinute(value: number) {
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}
export function parseMinute(value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value)) return NaN;
  const [h = 0, m = 0] = value.split(':').map(Number);
  return h * 60 + m;
}
