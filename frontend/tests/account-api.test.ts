import { expect, test, vi } from 'vitest';
import { api, ApiError } from '../src/features/account/api';

test('concurrent expired requests share one refresh and retry once', async () => {
  let refreshed = false;
  const fetch = vi.fn().mockImplementation((path: string) => {
    if (path.endsWith('/csrf'))
      return Promise.resolve(
        new Response(JSON.stringify({ csrf_token: 'a'.repeat(43) })),
      );
    if (path.endsWith('/refresh')) {
      refreshed = true;
      return Promise.resolve(new Response('{}'));
    }
    if (!refreshed)
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: 'unauthenticated', message: 'Please sign in.' },
          }),
          { status: 401 },
        ),
      );
    return Promise.resolve(new Response('[]'));
  });
  vi.stubGlobal('fetch', fetch);
  expect(await Promise.all([api('/workspaces'), api('/workspaces')])).toEqual([
    [],
    [],
  ]);
  expect(
    fetch.mock.calls.filter(([path]) => path === '/api/v1/auth/refresh'),
  ).toHaveLength(1);
});

test('non-JSON server errors have a safe actionable message', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })),
  );
  await expect(api('/workspaces')).rejects.toEqual(
    new ApiError(
      502,
      'invalid_response',
      'The service did not respond correctly. Please try again.',
    ),
  );
});
