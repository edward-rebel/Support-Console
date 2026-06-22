import {
  GmailNotConnectedError,
  hasTriageProvider,
  runSync,
  runTriage,
  type IntegrationsConfig,
} from "@ms/integrations";
import { syncState, type Db } from "@ms/db";
import type { SyncResultDTO, SyncStatusDTO } from "@ms/shared";

// Single-flight sync runner. Ingestion is idempotent and never sends email, so
// both the manual `POST /sync` trigger and the in-process scheduler share this
// one instance — preventing overlapping runs and exposing status for the UI.
export class SyncRunner {
  private running = false;
  private lastResult: SyncResultDTO | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly cfg: IntegrationsConfig,
  ) {}

  get status() {
    return {
      syncing: this.running,
      lastResult: this.lastResult,
      lastError: this.lastError,
    };
  }

  // Full status including the persisted last-sync timestamp (survives restarts).
  async statusWithPersisted(): Promise<SyncStatusDTO> {
    const rows = await this.db
      .select({
        inc: syncState.lastIncrementalSyncAt,
        full: syncState.lastFullSyncAt,
      })
      .from(syncState)
      .limit(1);
    const last = rows[0]?.inc ?? rows[0]?.full ?? null;
    return {
      syncing: this.running,
      lastResult: this.lastResult,
      lastError: this.lastError,
      lastSyncAt: last ? last.toISOString() : null,
    };
  }

  // Kicks a sync without blocking the caller. Returns whether a new run began.
  start(log: (msg: string, err?: unknown) => void): boolean {
    if (this.running) return false;
    this.running = true;
    this.lastError = null;
    void (async () => {
      try {
        const result = await runSync(this.db, this.cfg);
        this.lastResult = result;
        log(
          `Sync (${result.mode}) complete: ${result.messagesUpserted} new messages across ${result.threadsUpserted} threads`,
        );
        // Triage newly-ingested threads (deterministic rules + cheap model).
        // Never sends email. Skips silently if no API key is configured.
        if (hasTriageProvider(this.cfg)) {
          const t = await runTriage(this.db, this.cfg);
          log(
            `Triage: ${t.markedCustomer} customer, ${t.markedNoise} noise (${t.classifiedByModel} via model) of ${t.considered}`,
          );
        }
      } catch (err) {
        if (err instanceof GmailNotConnectedError) {
          this.lastError = err.message;
        } else {
          this.lastError = "Sync failed. See server logs.";
          log("Sync failed", err);
        }
      } finally {
        this.running = false;
      }
    })();
    return true;
  }
}
