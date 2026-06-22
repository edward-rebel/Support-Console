import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { requireEnv } from "./env";
import { createDb } from "./client";

// Applies all generated migrations in ./migrations, then exits.
async function main() {
  const { db, sql } = createDb(requireEnv("DATABASE_URL"));
  console.log("Running migrations…");
  // fileURLToPath (not URL.pathname) so a space in the repo path isn't left
  // percent-encoded — the migrator opens the folder with the literal path.
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  console.log("Migrations complete.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
