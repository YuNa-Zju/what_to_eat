import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connectSync,
  disconnectSync,
  isApplyingSync,
  hasPendingSync,
  readSync,
  syncNow,
  SYNC_CHANGE,
  SYNC_KEY,
} from '@/lib/personal-sync';
import { LOCAL_CHANGE } from '@/lib/storage';
import type { SyncSession } from '@/lib/sync-engine';

export function usePersonalSync() {
  const [session, setSession] = useState<SyncSession | null>(null);
  const [phase, setPhase] = useState<'off' | 'syncing' | 'synced' | 'waiting' | 'error'>('off');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const update = useCallback(() => {
    setSession(readSync());
  }, []);
  const run = useCallback(
    async (action = syncNow) => {
      if (busy.current) return;
      busy.current = true;
      setPhase('syncing');
      setError('');
      try {
        await action();
        update();
        setPhase(readSync() ? 'synced' : 'off');
      } catch (e) {
        setPhase('error');
        setError(e instanceof Error ? e.message : '同步失败，本机修改已保留');
        try {
          update();
        } catch {
          /* Keep the displayed state when storage is unavailable. */
        }
      } finally {
        busy.current = false;
      }
    },
    [update],
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      try {
        update();
        if (!readSync()) {
          setPhase('off');
          return;
        }
        if (isApplyingSync()) return;
        setPhase('waiting');
        clearTimeout(timer);
        if (navigator.onLine)
          timer = setTimeout(() => {
            void run();
          }, 600);
      } catch (e) {
        setError(e instanceof Error ? e.message : '无法读取同步设置');
        setPhase('error');
      }
    };
    const external = (event: StorageEvent) => {
      if (
        event.key !== null &&
        ![SYNC_KEY, 'what-to-eat:local:v1', 'what-to-eat:nickname:v1'].includes(event.key)
      )
        return;
      try {
        // A checkpoint from another tab is already synced. Do not ping-pong polls.
        update();
        if (hasPendingSync()) schedule();
        else if (!busy.current) setPhase(readSync() ? 'synced' : 'off');
      } catch {
        schedule();
      }
    };
    const refresh = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        try {
          if (readSync()) void run();
        } catch {
          schedule();
        }
      }
    };
    schedule();
    const interval = setInterval(refresh, 15000);
    window.addEventListener(LOCAL_CHANGE, schedule);
    window.addEventListener(SYNC_CHANGE, update);
    window.addEventListener('storage', external);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', schedule);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener(LOCAL_CHANGE, schedule);
      window.removeEventListener(SYNC_CHANGE, update);
      window.removeEventListener('storage', external);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', schedule);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [run, update]);
  return {
    session,
    phase,
    error,
    refresh: () => run(),
    connect: (code?: string) => run(() => connectSync(code)),
    disconnect: () => {
      try {
        disconnectSync();
        setSession(null);
        setPhase('off');
        setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : '暂时无法断开');
      }
    },
  };
}
export type PersonalSync = ReturnType<typeof usePersonalSync>;
