import { createDb, type Db } from "@ms/db";
import {
  autoDraftNewCustomerThreads,
  GmailNotConnectedError,
  hasTriageProvider,
  runSync,
  runTriage,
  type IntegrationsConfig,
} from "@ms/integrations";
import { loadEnv } from "./env";

// Triage + auto-draft new customer threads. Shared by --once and the loop.
async function triageAndDraft(db: Db, cfg: IntegrationsConfig): Promise<void> {
  if (!hasTriageProvider(cfg)) return;
  const t = await runTriage(db, cfg);
  console.log(
    `[worker] triage: ${t.markedCustomer} customer, ${t.markedNoise} noise (${t.classifiedByModel} via model) of ${t.considered}`,
  );
  if (process.env.AUTO_DRAFT_ENABLED !== "false") {
    const ad = await autoDraftNewCustomerThreads(db, cfg);
    if (ad.considered > 0) {
      console.log(
        `[worker] auto-draft: ${ad.drafted} drafted, ${ad.failed} failed of ${ad.considered}`,
      );
    }
  }
}

// Ingestion worker. Two modes:
//   --once   run a single sync and exit (Railway cron job).
//   default  run on a fixed interval (local dev / always-on service).
//
// Sync is idempotent and NEVER sends email — re-running is always safe.

async function runOnce(): Promise<void> {
  const env = loadEnv();
  const { db, sql } = createDb(env.databaseUrl);
  try {
    const result = await runSync(db, env.integrations);
    console.log(
      `[worker] sync (${result.mode}): ${result.messagesUpserted} new messages, ${result.threadsUpserted} threads touched`,
    );
    await triageAndDraft(db, env.integrations);
  } catch (err) {
    if (err instanceof GmailNotConnectedError) {
      console.warn(`[worker] ${err.message} — skipping until connected.`);
    } else {
      console.error("[worker] sync failed:", err);
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

async function runLoop(): Promise<void> {
  const env = loadEnv();
  const { db } = createDb(env.databaseUrl);
  const intervalMs = Math.max(1, env.intervalMinutes) * 60 * 1000;
  let stopping = false;

  const tick = async () => {
    try {
      const result = await runSync(db, env.integrations);
      console.log(
        `[worker] sync (${result.mode}): ${result.messagesUpserted} new messages, ${result.threadsUpserted} threads touched`,
      );
      await triageAndDraft(db, env.integrations);
    } catch (err) {
      if (err instanceof GmailNotConnectedError) {
        console.warn(`[worker] ${err.message} — will retry next interval.`);
      } else {
        console.error("[worker] sync failed:", err);
      }
    }
  };

  console.log(
    `[worker] starting; polling every ${env.intervalMinutes} min. Ctrl-C to stop.`,
  );
  await tick();
  const timer = setInterval(() => {
    if (!stopping) void tick();
  }, intervalMs);

  const shutdown = () => {
    stopping = true;
    clearInterval(timer);
    console.log("[worker] stopped.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Triage-only mode: classify existing threads without syncing Gmail. Useful for
// the one-time backfill. Optional limit: `--triage 50`.
async function triageOnce(): Promise<void> {
  const env = loadEnv();
  const { db, sql } = createDb(env.databaseUrl);
  try {
    if (!hasTriageProvider(env.integrations)) {
      console.warn("[worker] No AI provider key set — nothing to do.");
      return;
    }
    const idx = process.argv.indexOf("--triage");
    const limitArg = Number(process.argv[idx + 1]);
    const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : 5000;
    const t = await runTriage(db, env.integrations, limit);
    console.log(`[worker] triage:`, JSON.stringify(t));
  } finally {
    await sql.end();
  }
}

const mode = process.argv.includes("--triage")
  ? triageOnce()
  : process.argv.includes("--once")
    ? runOnce()
    : runLoop();
mode.catch((err) => {
  console.error(err);
  process.exit(1);
});
