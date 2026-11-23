import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/features/account/api';

export function useCalendarSync(workspaceId: string) {
  const cache = useQueryClient();
  const [state, setState] = useState('Connecting to live calendar…');
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let disposed = false;
    let stopped = false;
    let generation = 0;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const close = () => {
      generation++;
      source?.close();
      source = null;
      clearTimeout(timer);
      clearTimeout(watchdog);
    };
    const deny = () => {
      stopped = true;
      close();
      setBlocked(true);
      setState(
        'Calendar access ended. Sign in or select an authorized workspace.',
      );
      for (const key of [
        'calendar',
        'bookings',
        'availability',
        'booking-config',
      ]) {
        void cache.cancelQueries({ queryKey: [key, workspaceId] });
        cache.removeQueries({ queryKey: [key, workspaceId] });
      }
    };
    const refresh = () => {
      for (const key of ['calendar', 'bookings', 'availability'])
        void cache.invalidateQueries({ queryKey: [key, workspaceId] });
    };
    const schedule = () => {
      close();
      if (disposed || stopped) return;
      setState('Connection interrupted. Reconnecting…');
      timer = setTimeout(
        () => void connect(),
        Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)),
      );
    };
    const connect = async () => {
      close();
      if (disposed || stopped) return;
      if (document.hidden || !navigator.onLine) {
        setState(
          'Live updates paused. Changes will refresh when you return online.',
        );
        return;
      }
      const attempt = generation;
      try {
        // The regular API handles cookie refresh and gives useful 401/403/404 errors
        // that native EventSource intentionally does not expose.
        await api(`/workspaces/${workspaceId}/calendar/revision`);
        if (disposed || stopped || attempt !== generation) return;
        source = new EventSource(
          `/api/v1/workspaces/${workspaceId}/calendar/events`,
        );
        const heartbeat = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(schedule, 15000);
        };
        heartbeat();
        source.addEventListener('ready', () => {
          if (attempt !== generation) return;
          failures = 0;
          heartbeat();
          refresh();
          setState('Live calendar updates connected');
        });
        const active = () => !disposed && attempt === generation;
        source.addEventListener('changed', () => {
          if (active()) {
            heartbeat();
            refresh();
          }
        });
        source.addEventListener('heartbeat', () => {
          if (active()) heartbeat();
        });
        source.addEventListener('access-lost', () => {
          if (active()) deny();
        });
        source.addEventListener('expired', () => {
          if (active()) schedule();
        });
        source.addEventListener('reconnect', () => {
          if (active()) void connect();
        });
        source.onerror = () => {
          if (active()) schedule();
        };
      } catch (error) {
        if (disposed || attempt !== generation) return;
        if (error instanceof ApiError && [401, 403, 404].includes(error.status))
          deny();
        else schedule();
      }
    };
    const resume = () => {
      if (!stopped) void connect();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    void connect();
    return () => {
      disposed = true;
      close();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
    };
  }, [cache, workspaceId]);
  return { state, blocked };
}
