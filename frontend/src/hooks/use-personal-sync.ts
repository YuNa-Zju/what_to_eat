import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connectSync,
  disconnectSync,
  hasPendingSync,
  readSync,
  syncNow,
  SYNC_CHANGE,
  SYNC_KEY,
} from '@/lib/personal-sync';
import { LOCAL_CHANGE } from '@/lib/storage';
import { SYNC_STORAGE_CHANGE, hydrateSyncStorage } from '@/lib/sync-transaction';
import type { SyncSession } from '@/lib/sync-engine';

export function usePersonalSync() {
  const [session, setSession] = useState<SyncSession | null>(null);
  const [phase, setPhase] = useState<'off' | 'syncing' | 'synced' | 'waiting' | 'error'>('off');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const [inProgress, setInProgress] = useState(false);
  const update = useCallback(() => {
    setSession(readSync());
  }, []);
  const run = useCallback(
    async (action = syncNow) => {
      if (busy.current) return false;
      busy.current = true;
      setInProgress(true);
      setPhase('syncing');
      setError('');
      try {
        await action();
        update();
        setPhase(readSync() ? (hasPendingSync() ? 'waiting' : 'synced') : 'off');
        return true;
      } catch (e) {
        setPhase('error');
        setError(e instanceof Error ? e.message : '同步失败，本机修改已保留');
        try {
          update();
        } catch {
          /* Keep the displayed state when storage is unavailable. */
        }
        return false;
      } finally {
        busy.current = false;
        setInProgress(false);
      }
    },
    [update],
  );
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      try {
        update();
        if (!readSync()) {
          setPhase('off');
          return;
        }
        if (!hasPendingSync()) {
          if (!busy.current) setPhase('synced');
          return;
        }
        if (!busy.current) setPhase('waiting');
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
    const hydrated = () => external({ key: null } as StorageEvent);
    const refresh = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        try {
          if (readSync()) void run();
        } catch {
          schedule();
        }
      }
    };
    void hydrateSyncStorage().then(() => {
      if (disposed) return;
      schedule();
      refresh();
    });
    const interval = setInterval(refresh, 15000);
    window.addEventListener(LOCAL_CHANGE, schedule);
    window.addEventListener(SYNC_CHANGE, update);
    window.addEventListener(SYNC_STORAGE_CHANGE, hydrated);
    window.addEventListener('storage', external);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', schedule);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener(LOCAL_CHANGE, schedule);
      window.removeEventListener(SYNC_CHANGE, update);
      window.removeEventListener(SYNC_STORAGE_CHANGE, hydrated);
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
    busy: inProgress,
    refresh: () => run(),
    connect: (code?: string) => run(() => connectSync(code)),
    disconnect: () => run(disconnectSync),
  };
}
export type PersonalSync = ReturnType<typeof usePersonalSync>;
