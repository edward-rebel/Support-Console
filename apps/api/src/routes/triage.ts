import type { FastifyInstance } from "fastify";
import {
  reclassifyThread,
  runTriage,
  type IntegrationsConfig,
  type TriageResult,
} from "@ms/integrations";
import type { Db } from "@ms/db";
import { requireAuth } from "../auth";

// Single-flight backfill runner. Triage is idempotent (only classifies threads
// with is_customer IS NULL) and never sends email.
class TriageRunner {
  private running = false;
  private lastResult: TriageResult | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly cfg: IntegrationsConfig,
  ) {}

  get status() {
    return {
      running: this.running,
      lastResult: this.lastResult,
      lastError: this.lastError,
      configured: Boolean(this.cfg.anthropicApiKey),
    };
  }

  start(log: (msg: string, err?: unknown) => void): boolean {
    if (this.running) return false;
    this.running = true;
    this.lastError = null;
    void (async () => {
      try {
        this.lastResult = await runTriage(this.db, this.cfg);
        log(
          `Triage backfill complete: ${this.lastResult.markedCustomer} customer, ${this.lastResult.markedNoise} noise of ${this.lastResult.considered}`,
        );
      } catch (err) {
        this.lastError = "Triage failed. See server logs.";
        log("Triage failed", err);
      } finally {
        this.running = false;
      }
    })();
    return true;
  }
}

export function registerTriageRoutes(app: FastifyInstance): void {
  const { db, env } = app.appCtx;
  const runner = new TriageRunner(db, env.integrations);

  app.post("/triage/run", { preHandler: requireAuth }, async (_req, reply) => {
    if (!env.integrations.anthropicApiKey) {
      return reply
        .code(400)
        .send({ error: "ANTHROPIC_API_KEY is not configured." });
    }
    const started = runner.start((msg, err) => {
      if (err) app.log.error({ err }, msg);
      else app.log.info(msg);
    });
    return reply.send({ started, ...runner.status });
  });

  app.get("/triage/status", { preHandler: requireAuth }, async (_req, reply) => {
    return reply.send(runner.status);
  });

  // Operator override from the inbox: "Not noise?" (forceCustomer true) or
  // "Dismiss / not a request" (forceCustomer false).
  app.post<{ Params: { id: string }; Body: { isCustomer?: boolean } }>(
    "/threads/:id/reclassify",
    { preHandler: requireAuth },
    async (request, reply) => {
      const forceCustomer = request.body?.isCustomer;
      const out = await reclassifyThread(db, env.integrations, request.params.id, {
        forceCustomer,
      });
      if (!out) return reply.code(404).send({ error: "Thread not found" });
      return reply.send(out);
    },
  );
}
