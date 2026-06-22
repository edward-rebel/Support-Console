import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import {
  CONNECTION_PROVIDERS,
  DRAFT_STATUSES,
  EMBEDDING_DIMENSIONS,
  KNOWLEDGE_ENTRY_TYPES,
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
export const knowledgeEntryTypeEnum = pgEnum("knowledge_entry_type", [
  ...KNOWLEDGE_ENTRY_TYPES,
] as [string, ...string[]]);
export const draftStatusEnum = pgEnum("draft_status", [
  ...DRAFT_STATUSES,
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
    // Customer sentiment from triage: positive|neutral|negative|frustrated
    // (null until triaged; only set on customer threads, mirroring categoryId).
    sentiment: text("sentiment"),
    sentimentScore: integer("sentiment_score"), // 0-100 satisfaction, null if unknown
    // 1-2 sentence AI summary of the customer's request; null until triaged.
    summary: text("summary"),
    // The Shopify order pinned to this thread (e.g. "#21142") — set when an order
    // is resolved (manually or extracted from the email) so context survives a
    // reload without re-resolving. Read-only reference; not a write to Shopify.
    shopifyOrderName: text("shopify_order_name"),
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
    // Attachment metadata (filename/mimeType/size/attachmentId/inline) derived
    // from the MIME tree; bytes are fetched on demand from Gmail, not stored.
    attachments: jsonb("attachments"),
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

// ── knowledge_entries ─ the RAG corpus (spec §7) ─────────────────────────────
// Mined/distilled from historical customer threads. `embedding` is null until
// the entry is embedded (the build job fills it; editing an entry clears it so
// it gets re-embedded). Retrieval = top-k cosine search scoped by category.
export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: knowledgeEntryTypeEnum("type").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    question: text("question"), // null for policies; the customer ask otherwise
    answer: text("answer").notNull(), // the canonical/example/policy text
    sourceThreadId: text("source_thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    typeIdx: index("knowledge_entries_type_idx").on(t.type),
    categoryIdx: index("knowledge_entries_category_id_idx").on(t.categoryId),
    // One example per source thread — keeps the mining job idempotent.
    sourceUnique: uniqueIndex("knowledge_entries_source_thread_unique")
      .on(t.sourceThreadId)
      .where(sql`source_thread_id IS NOT NULL AND type = 'example'`),
    // Approximate-nearest-neighbour index for cosine similarity retrieval.
    embeddingIdx: index("knowledge_entries_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  }),
);

// ── tone_profile ─ brand voice, single active row (spec §7) ──────────────────
export const toneProfile = pgTable("tone_profile", {
  id: uuid("id").defaultRandom().primaryKey(),
  content: text("content").notNull(),
  version: integer("version").default(1).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

// ── drafts ─ AI-generated reply awaiting human review (spec §7) ──────────────
// One active (pending) draft per thread in practice; regenerating supersedes the
// prior one. Email is only ever sent from an approved draft (Phase 3 send path).
export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    confidence: text("confidence"), // high|medium|low
    status: draftStatusEnum("status").default("pending").notNull(),
    // Provenance: the knowledge entries / order context the draft was grounded
    // in (shown as "Draft based on…" and kept for auditing).
    basedOn: jsonb("based_on"),
    // A suggested Shopify action for the human to perform manually (read-only
    // integration — we never execute it). Plain text.
    recommendedAction: text("recommended_action"),
    modelId: text("model_id"),
    promptVersion: text("prompt_version"),
    ...timestamps,
  },
  (t) => ({
    threadIdx: index("drafts_thread_id_idx").on(t.threadId),
    statusIdx: index("drafts_status_idx").on(t.status),
  }),
);

// ── sends ─ immutable audit log; one row per email actually sent (spec §7) ───
export const sends = pgTable(
  "sends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    draftId: uuid("draft_id").references(() => drafts.id),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    sentGmailMessageId: text("sent_gmail_message_id"),
    bodySnapshot: text("body_snapshot").notNull(),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    threadIdx: index("sends_thread_id_idx").on(t.threadId),
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
export type KnowledgeEntry = typeof knowledgeEntries.$inferSelect;
export type NewKnowledgeEntry = typeof knowledgeEntries.$inferInsert;
export type ToneProfileRow = typeof toneProfile.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;
export type Send = typeof sends.$inferSelect;
