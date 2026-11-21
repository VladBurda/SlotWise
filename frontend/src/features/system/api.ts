import { z } from 'zod';

const readinessSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
  database: z.boolean(),
  redis: z.boolean(),
});
export async function getReadiness(signal?: AbortSignal) {
  const response = await fetch('/api/v1/health/ready', {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok && response.status !== 503)
    throw new Error('Unable to reach the API.');
  return readinessSchema.parse(await response.json());
}
