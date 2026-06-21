import { sql as raw } from "drizzle-orm";
import { requireEnv } from "./env";
import { createDb } from "./client";

// One-time helper: enable the pgvector extension. Not needed in Phase 0 (no
// vector columns yet) but harmless to run now; Phase 2 (knowledge base) relies
// on it. Flags clearly if the Postgres instance lacks pgvector.
async function main() {
  const { db, sql } = createDb(requireEnv("DATABASE_URL"));
  try {
    await db.execute(raw`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log("pgvector extension is enabled.");
  } catch (err) {
    console.error(
      "Could not enable pgvector. The Postgres instance may not ship the " +
        "extension — on Railway, ensure you're using an image that includes " +
        "pgvector (or add it) before Phase 2.",
    );
    console.error(err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
