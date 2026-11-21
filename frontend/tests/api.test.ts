import { expect, test, vi } from 'vitest';
import { getReadiness } from '../src/features/system/api';

test('rejects unexpected HTTP failures', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })),
  );
  await expect(getReadiness()).rejects.toThrow('Unable to reach the API.');
});

test('rejects malformed health payloads', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: 'ready', database: 'yes' })),
      ),
  );
  await expect(getReadiness()).rejects.toThrow();
});
