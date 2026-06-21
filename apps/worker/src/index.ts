import { createDb } from "@ms/db";
import { GmailNotConnectedError, runSync } from "@ms/integrations";
import { loadEnv } from "./env";

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

const once = process.argv.includes("--once");
(once ? runOnce() : runLoop()).catch((err) => {
  console.error(err);
  process.exit(1);
});
