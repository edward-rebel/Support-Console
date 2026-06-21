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
  // Increments each time a sync finishes — screens watch this to refetch.
  completedAt: number;
  triggerSync: () => Promise<void>;
}

const Ctx = createContext<SyncCtx | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState(0);
  const pollRef = useRef<number | null>(null);

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
        setLastError(status.lastError);
        if (!status.syncing) {
          setSyncing(false);
          setCompletedAt(Date.now());
          stopPolling();
        }
      } catch {
        setSyncing(false);
        stopPolling();
      }
    }, 1500);
  }, [stopPolling]);

  const triggerSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setLastError(null);
    try {
      const res = await api.sync();
      setLastError(res.lastError);
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

  useEffect(() => () => stopPolling(), [stopPolling]);

  return (
    <Ctx.Provider value={{ syncing, lastError, completedAt, triggerSync }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSync(): SyncCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
