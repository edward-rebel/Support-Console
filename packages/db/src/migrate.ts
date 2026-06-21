import { migrate } from "drizzle-orm/postgres-js/migrator";
import { requireEnv } from "./env";
import { createDb } from "./client";

// Applies all generated migrations in ./migrations, then exits.
async function main() {
  const { db, sql } = createDb(requireEnv("DATABASE_URL"));
  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
  console.log("Migrations complete.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
