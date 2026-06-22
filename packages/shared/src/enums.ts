// Single source of truth for the string unions used across api, web, and worker.
// Keep these in sync with the Drizzle enum definitions in @ms/db.

export const THREAD_STATUSES = [
  "new",
  "drafting",
  "needs_review",
  "sent",
  "dismissed",
  // Manually closed by the operator without sending a reply (e.g. the customer
  // said "thanks, got it"). Counts as answered: excluded from Open and Sent,
  // still visible under All.
  "closed",
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

// Customer satisfaction signal, produced by the triage pass alongside the
// category. positive = happy/thankful; neutral = routine; negative = unhappy/
// complaint; frustrated = angry / repeated contact / escalation language.
export const SENTIMENTS = ["positive", "neutral", "negative", "frustrated"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

// In-app user feedback. `type` is AI-assigned from the free-text message; the
// user never classifies it themselves.
export const FEEDBACK_TYPES = ["bug", "feature", "enhancement", "question", "other"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export const FEEDBACK_STATUSES = ["open", "addressed", "dismissed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

// Dimension of the stored knowledge embeddings. Must match the embeddings
// provider's output (OpenAI text-embedding-3-small = 1536) AND the pgvector
// column width in @ms/db. Change all three together (provider, this constant,
// a migration) if the embeddings model ever changes.
export const EMBEDDING_DIMENSIONS = 1536;
