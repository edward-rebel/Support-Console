import type { FastifyInstance } from "fastify";
import {
  GmailNotConnectedError,
  runSync,
  type IntegrationsConfig,
} from "@ms/integrations";
import type { Db } from "@ms/db";
import type { SyncResultDTO } from "@ms/shared";
import { requireAuth } from "../auth";

// Single-flight sync runner. Ingestion is idempotent and never sends email, so
// a manual trigger is safe; we just prevent overlapping runs and expose status
// for the design's Sync button + header pill.
class SyncRunner {
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

  // Kicks a sync without blocking the request. Returns whether a new run began.
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

export function registerSyncRoutes(app: FastifyInstance): void {
  const { db, env } = app.appCtx;
  const runner = new SyncRunner(db, env.integrations);

  app.post("/sync", { preHandler: requireAuth }, async (_request, reply) => {
    const started = runner.start((msg, err) => {
      if (err) app.log.error({ err }, msg);
      else app.log.info(msg);
    });
    return reply.send({ started, ...runner.status });
  });

  app.get(
    "/sync/status",
    { preHandler: requireAuth },
    async (_request, reply) => {
      return reply.send(runner.status);
    },
  );
}
