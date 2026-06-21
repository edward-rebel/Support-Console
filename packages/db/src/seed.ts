import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { CATEGORIES, SENDER_RULE_SEEDS } from "@ms/shared";
import { requireEnv } from "./env";
import { createDb } from "./client";
import { categories, senderRules, syncState, users } from "./schema";

// Idempotent seed: categories, starter sender rules, the single operator, and a
// sync_state singleton. Safe to re-run — uses onConflict / existence checks.
async function main() {
  const { db, sql } = createDb(requireEnv("DATABASE_URL"));
  const operatorEmail = requireEnv("OPERATOR_EMAIL").toLowerCase();
  const operatorPassword = requireEnv("OPERATOR_PASSWORD");

  // Categories.
  for (const c of CATEGORIES) {
    await db
      .insert(categories)
      .values({ slug: c.slug, name: c.name, color: c.color })
      .onConflictDoUpdate({
        target: categories.slug,
        set: { name: c.name, color: c.color },
      });
  }
  console.log(`Seeded ${CATEGORIES.length} categories.`);

  // Sender rules.
  for (const r of SENDER_RULE_SEEDS) {
    await db
      .insert(senderRules)
      .values({ pattern: r.pattern, rule: r.rule, note: r.note })
      .onConflictDoNothing({ target: senderRules.pattern });
  }
  console.log(`Seeded ${SENDER_RULE_SEEDS.length} sender rules.`);

  // Operator (single row). Update the hash if the operator already exists so a
  // changed OPERATOR_PASSWORD takes effect on re-seed.
  const passwordHash = await bcrypt.hash(operatorPassword, 12);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, operatorEmail))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.email, operatorEmail));
    console.log(`Updated operator: ${operatorEmail}`);
  } else {
    await db.insert(users).values({ email: operatorEmail, passwordHash });
    console.log(`Created operator: ${operatorEmail}`);
  }

  // sync_state singleton.
  const stateRows = await db.select({ id: syncState.id }).from(syncState).limit(1);
  if (stateRows.length === 0) {
    await db.insert(syncState).values({});
    console.log("Initialized sync_state.");
  }

  await sql.end();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
