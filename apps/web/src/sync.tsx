import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "./api";

interface SyncCtx {
  syncing: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
  // Increments each time a sync finishes — screens watch this to refetch.
  completedAt: number;
  triggerSync: () => Promise<void>;
}

const Ctx = createContext<SyncCtx | null>(null);

const IDLE_POLL_MS = 25_000;

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState(0);
  const pollRef = useRef<number | null>(null);
  const idleRef = useRef<number | null>(null);
  const lastSeenRef = useRef<string | null>(null);

  // Apply a status payload; bump completedAt whenever the persisted last-sync
  // timestamp advances (covers both manual and background scheduler syncs).
  const applyStatus = useCallback(
    (s: { syncing: boolean; lastError: string | null; lastSyncAt: string | null }) => {
      setLastError(s.lastError);
      setLastSyncAt(s.lastSyncAt);
      setSyncing(s.syncing);
      if (s.lastSyncAt && s.lastSyncAt !== lastSeenRef.current) {
        if (lastSeenRef.current !== null) setCompletedAt(Date.now());
        lastSeenRef.current = s.lastSyncAt;
      }
    },
    [],
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(() => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const status = await api.syncStatus();
        applyStatus(status);
        if (!status.syncing) {
          setCompletedAt(Date.now());
          stopPolling();
        }
      } catch {
        setSyncing(false);
        stopPolling();
      }
    }, 1500);
  }, [stopPolling, applyStatus]);

  const triggerSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setLastError(null);
    try {
      const res = await api.sync();
      setLastError(res.lastError);
      setLastSyncAt(res.lastSyncAt);
      if (res.syncing || res.started) {
        poll();
      } else {
        setSyncing(false);
        setCompletedAt(Date.now());
      }
    } catch {
      setSyncing(false);
    }
  }, [syncing, poll]);

  // Slow idle poll so scheduler-driven background syncs surface within ~25s.
  // Paused while the tab is hidden; fetches immediately on focus.
  useEffect(() => {
    const tick = async () => {
      if (document.hidden || pollRef.current !== null) return;
      try {
        applyStatus(await api.syncStatus());
      } catch {
        /* keep prior state on a transient failure */
      }
    };
    void tick();
    idleRef.current = window.setInterval(() => void tick(), IDLE_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (idleRef.current !== null) window.clearInterval(idleRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applyStatus]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  return (
    <Ctx.Provider
      value={{ syncing, lastError, lastSyncAt, completedAt, triggerSync }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSync(): SyncCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
