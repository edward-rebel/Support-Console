import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CONNECTION_PROVIDERS,
  MESSAGE_DIRECTIONS,
  SENDER_RULE_KINDS,
  THREAD_STATUSES,
} from "@ms/shared";

// ── Enums ────────────────────────────────────────────────────────────────────
// Cast the shared readonly tuples to the mutable tuple shape pgEnum expects.
export const threadStatusEnum = pgEnum("thread_status", [
  ...THREAD_STATUSES,
] as [string, ...string[]]);
export const messageDirectionEnum = pgEnum("message_direction", [
  ...MESSAGE_DIRECTIONS,
] as [string, ...string[]]);
export const senderRuleKindEnum = pgEnum("sender_rule_kind", [
  ...SENDER_RULE_KINDS,
] as [string, ...string[]]);
export const connectionProviderEnum = pgEnum("connection_provider", [
  ...CONNECTION_PROVIDERS,
] as [string, ...string[]]);

// Reused column helpers.
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

// ── users ─ single operator in practice (spec §7) ───────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  ...timestamps,
});

// ── sync_state ─ Gmail incremental sync bookkeeping ─────────────────────────
export const syncState = pgTable("sync_state", {
  id: uuid("id").defaultRandom().primaryKey(),
  lastHistoryId: text("last_history_id"),
  lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
  lastIncrementalSyncAt: timestamp("last_incremental_sync_at", {
    withTimezone: true,
  }),
  ...timestamps,
});

// ── sender_rules ─ triage allow/block list ──────────────────────────────────
export const senderRules = pgTable(
  "sender_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pattern: text("pattern").notNull(),
    rule: senderRuleKindEnum("rule").notNull(),
    note: text("note"),
    ...timestamps,
  },
  (t) => ({
    patternUnique: uniqueIndex("sender_rules_pattern_unique").on(t.pattern),
  }),
);

// ── categories ─ request types ──────────────────────────────────────────────
export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

// ── threads ─ one per Gmail thread; id is the Gmail thread id (natural key) ──
export const threads = pgTable(
  "threads",
  {
    id: text("id").primaryKey(),
    subject: text("subject"),
    customerEmail: text("customer_email"),
    customerName: text("customer_name"),
    isCustomer: boolean("is_customer"), // null until triaged (Phase 1)
    categoryId: uuid("category_id").references(() => categories.id),
    snippet: text("snippet"), // one-line preview for the inbox row
    status: threadStatusEnum("status").default("new").notNull(),
    confidence: text("confidence"), // high|medium|low, set when a draft exists (Phase 3)
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    lastMessageIdx: index("threads_last_message_at_idx").on(t.lastMessageAt),
    statusIdx: index("threads_status_idx").on(t.status),
  }),
);

// ── messages ─ one per email; id is the Gmail message id (natural key) ───────
// The natural-key primary key is what makes ingestion idempotent: re-running
// sync upserts on conflict and never duplicates a message.
export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    // Threading headers: Message-ID, In-Reply-To, References (spec §3.5).
    headers: jsonb("headers"),
    gmailInternalDate: timestamp("gmail_internal_date", { withTimezone: true }),
    // Full raw Gmail message payload — preserved permanently (spec §3.4) so
    // every later AI step can re-run without re-fetching from Gmail.
    raw: jsonb("raw"),
    ...timestamps,
  },
  (t) => ({
    threadIdx: index("messages_thread_id_idx").on(t.threadId),
    dateIdx: index("messages_internal_date_idx").on(t.gmailInternalDate),
  }),
);

// ── connections ─ stored integration credentials (encrypted at rest) ─────────
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: connectionProviderEnum("provider").notNull(),
    // AES-256-GCM ciphertext of the OAuth token bundle (spec §3.7).
    encryptedTokens: jsonb("encrypted_tokens"),
    accountIdentifier: text("account_identifier"),
    status: text("status").default("connected").notNull(),
    ...timestamps,
  },
  (t) => ({
    providerUnique: uniqueIndex("connections_provider_unique").on(t.provider),
  }),
);

// Convenience inferred types.
export type User = typeof users.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type SyncStateRow = typeof syncState.$inferSelect;
