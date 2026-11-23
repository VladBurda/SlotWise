import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { api, ApiError } from '../src/features/account/api';
import { useCalendarSync } from '../src/features/calendar/useCalendarSync';

vi.mock('../src/features/account/api', async (original) => ({
  ...(await original<typeof import('../src/features/account/api')>()),
  api: vi.fn(),
}));
class Stream extends EventTarget {
  static instances: Stream[] = [];
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    super();
    Stream.instances.push(this);
  }
}
afterEach(() => vi.useRealTimers());
test('heartbeats keep the stream open and silent connections are retried', async () => {
  const { unmount } = await setup();
  const source = Stream.instances[0]!;
  act(() => source.dispatchEvent(new Event('ready')));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(14000);
  });
  act(() => source.dispatchEvent(new Event('heartbeat')));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(14000);
  });
  expect(source.close).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(source.close).toHaveBeenCalled();
  expect(Stream.instances).toHaveLength(2);
  unmount();
});
async function setup() {
  vi.useFakeTimers();
  Stream.instances = [];
  vi.stubGlobal('EventSource', Stream);
  vi.mocked(api).mockReset().mockResolvedValue({ revision: '0' });
  const cache = new QueryClient();
  const invalidate = vi.spyOn(cache, 'invalidateQueries');
  const hook = renderHook(() => useCalendarSync('workspace-a'), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { ...hook, cache, invalidate };
}
test('initial and reconnected streams refresh snapshots; changes stay workspace scoped', async () => {
  const { invalidate, unmount } = await setup();
  const first = Stream.instances[0]!;
  expect(first.url).toContain('/workspaces/workspace-a/calendar/events');
  act(() => first.dispatchEvent(new Event('ready')));
  expect(invalidate).toHaveBeenCalledTimes(3);
  act(() => first.dispatchEvent(new Event('changed')));
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['calendar', 'workspace-a'],
  });
  act(() => first.onerror?.());
  expect(first.close).toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(Stream.instances).toHaveLength(2);
  act(() => Stream.instances[1]!.dispatchEvent(new Event('ready')));
  expect(invalidate).toHaveBeenCalledTimes(9);
  act(() => first.dispatchEvent(new Event('changed')));
  expect(invalidate).toHaveBeenCalledTimes(9);
  unmount();
  expect(Stream.instances[1]!.close).toHaveBeenCalled();
});
test('access revocation stops reconnecting and removes sensitive cached data', async () => {
  const { cache, result, unmount } = await setup();
  cache.setQueryData(['calendar', 'workspace-a'], ['private']);
  act(() => Stream.instances[0]!.dispatchEvent(new Event('access-lost')));
  expect(result.current.blocked).toBe(true);
  expect(cache.getQueryData(['calendar', 'workspace-a'])).toBeUndefined();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(Stream.instances).toHaveLength(1);
  unmount();
});
test('offline resume refreshes after missed changes and authorization failure blocks display', async () => {
  const { result, unmount } = await setup();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  act(() => window.dispatchEvent(new Event('offline')));
  expect(result.current.state).toContain('paused');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(api).mockRejectedValue(
    new ApiError(403, 'forbidden', 'Access ended'),
  );
  await act(async () => {
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
  });
  expect(result.current.blocked).toBe(true);
  expect(Stream.instances).toHaveLength(1);
  unmount();
});
