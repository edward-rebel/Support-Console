// Single source of truth for the string unions used across api, web, and worker.
// Keep these in sync with the Drizzle enum definitions in @ms/db.

export const THREAD_STATUSES = [
  "new",
  "drafting",
  "needs_review",
  "sent",
  "dismissed",
] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

// Defined now for type-completeness; drafts are not produced until Phase 3.
export const DRAFT_STATUSES = [
  "pending",
  "approved",
  "sent",
  "dismissed",
  "superseded",
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const SENDER_RULE_KINDS = ["allow", "block"] as const;
export type SenderRuleKind = (typeof SENDER_RULE_KINDS)[number];

export const CONNECTION_PROVIDERS = ["gmail", "shopify"] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];

export const KNOWLEDGE_ENTRY_TYPES = ["canonical", "example", "policy"] as const;
export type KnowledgeEntryType = (typeof KNOWLEDGE_ENTRY_TYPES)[number];
