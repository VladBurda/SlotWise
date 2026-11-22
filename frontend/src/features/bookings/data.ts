import { z } from 'zod';
import { api } from '@/features/account/api';
import { locationSchema } from '@/features/business/contracts';
import { itemSchema } from '@/features/catalog/contracts';

async function pages<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = z
      .array(schema)
      .parse(await api(`${path}?offset=${offset}&limit=100`));
    result.push(...page);
    if (page.length < 100) return result;
  }
}
export async function loadBookingConfig(workspaceId: string) {
  const root = `/workspaces/${workspaceId}`;
  const [locations, ...groups] = await Promise.all([
    pages(`${root}/locations`, locationSchema),
    ...(['services', 'staff', 'resources'] as const).map((kind) =>
      pages(`${root}/catalog/${kind}`, itemSchema),
    ),
  ]);
  return { locations, items: groups.flat() };
}
