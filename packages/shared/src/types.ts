import type {
  ConfidenceLevel,
  DraftStatus,
  FeedbackStatus,
  FeedbackType,
  KnowledgeEntryType,
  MessageDirection,
  Sentiment,
  ThreadStatus,
} from "./enums";

// API-facing shapes. These describe what the api returns and the web consumes —
// not the raw DB rows. Dates are serialized as ISO strings over the wire.

export interface CategoryDTO {
  id: string;
  slug: string;
  name: string;
  color: string;
}

export interface ThreadSummaryDTO {
  id: string;
  subject: string | null;
  customerEmail: string | null;
  customerName: string | null;
  isCustomer: boolean | null;
  category: CategoryDTO | null;
  status: ThreadStatus;
  confidence: ConfidenceLevel | null;
  sentiment: Sentiment | null;
  unread: boolean;
  snippet: string | null;
  lastMessageAt: string | null;
}

export interface AttachmentDTO {
  id: string; // Gmail attachmentId
  messageId: string;
  filename: string;
  mimeType: string;
  size: number;
  inline: boolean;
}

export interface MessageDTO {
  id: string;
  threadId: string;
  direction: MessageDirection;
  fromAddress: string | null;
  toAddress: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  gmailInternalDate: string | null;
  attachments: AttachmentDTO[];
}

export interface ThreadDetailDTO extends ThreadSummaryDTO {
  // 1-2 sentence AI summary of the customer's request (null until triaged).
  summary: string | null;
  messages: MessageDTO[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OperatorDTO {
  id: string;
  email: string;
}

export interface SyncResultDTO {
  ok: boolean;
  mode: "backfill" | "incremental";
  threadsUpserted: number;
  messagesUpserted: number;
  startedAt: string;
  finishedAt: string;
}

// Live sync status for the header. lastSyncAt is read from sync_state so it
// survives process restarts (unlike the in-memory lastResult).
export interface SyncStatusDTO {
  syncing: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
  lastResult: SyncResultDTO | null;
}

// ── Insights (analytics dashboard) ───────────────────────────────────────────

export interface CategoryVolumeDTO {
  category: CategoryDTO | null; // null = uncategorized
  count: number;
}
export interface StatusBreakdownDTO {
  status: ThreadStatus;
  count: number;
}
export interface SentimentBucketDTO {
  sentiment: Sentiment;
  count: number;
}
export interface TrendPointDTO {
  date: string; // YYYY-MM-DD
  received: number;
  sent: number;
}
// ── In-app feedback ──────────────────────────────────────────────────────────
export interface FeedbackDTO {
  id: string;
  message: string;
  title: string | null;
  type: FeedbackType | null;
  page: string | null;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InsightsDTO {
  range: string;
  totals: {
    total: number;
    customer: number;
    noise: number;
    untriaged: number;
  };
  byCategory: CategoryVolumeDTO[];
  byStatus: StatusBreakdownDTO[];
  sentiment: { available: boolean; buckets: SentimentBucketDTO[] };
  activity: {
    draftsGenerated: number;
    sent: number;
    approvalRate: number;
    confidenceMix: { level: ConfidenceLevel; count: number }[];
  };
  trend: TrendPointDTO[];
}

// ── Knowledge base (Phase 2) ─────────────────────────────────────────────────

export interface KnowledgeEntryDTO {
  id: string;
  type: KnowledgeEntryType;
  category: CategoryDTO | null;
  question: string | null;
  answer: string;
  sourceThreadId: string | null;
  isActive: boolean;
  // True once an embedding has been computed for the current text. Edits clear
  // it until the entry is re-embedded.
  embedded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToneProfileDTO {
  id: string;
  content: string;
  version: number;
  updatedAt: string;
}

// Progress/outcome of the historical-mining batch job.
export interface KnowledgeBuildResult {
  threadsScanned: number;
  examplesMined: number;
  canonicalsWritten: number;
  policiesWritten: number;
  toneProfileUpdated: boolean;
  entriesEmbedded: number;
}

// ── Shopify read-only context (Phase 4) ──────────────────────────────────────

export interface ShopifyTrackingDTO {
  number: string | null;
  url: string | null;
  company: string | null;
}

export interface ShopifyOrderDTO {
  name: string; // "#21142"
  createdAt: string;
  financialStatus: string | null; // PAID, REFUNDED, …
  fulfillmentStatus: string | null; // FULFILLED, UNFULFILLED, …
  total: string | null;
  currency: string | null;
  lineItems: { title: string; quantity: number }[];
  tracking: ShopifyTrackingDTO[];
}

export interface ShopifyCustomerDTO {
  name: string | null;
  email: string | null;
  phone: string | null;
  ordersCount: number | null;
  totalSpent: string | null;
  currency: string | null;
  createdAt: string;
}

export type ShopifyMatch = "pinned" | "email" | "order" | null;

export interface ShopifyContextDTO {
  found: boolean;
  customer: ShopifyCustomerDTO | null;
  orders: ShopifyOrderDTO[];
  // How the context was resolved for a thread (email vs order-number fallback vs
  // a previously pinned order). Null for ad-hoc lookups.
  matchedBy?: ShopifyMatch;
}

// ── Drafting + send (Phase 3) ────────────────────────────────────────────────

// One piece of provenance the draft was grounded in (a knowledge entry or an
// order). Shown as "Draft based on…" and stored for auditing.
export interface BasedOnItemDTO {
  kind: "canonical" | "example" | "policy" | "order" | "tone";
  label: string;
  detail?: string | null;
}

export interface DraftDTO {
  id: string;
  threadId: string;
  body: string;
  confidence: ConfidenceLevel | null;
  status: DraftStatus;
  basedOn: BasedOnItemDTO[];
  recommendedAction: string | null;
  modelId: string | null;
  promptVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SendResultDTO {
  ok: boolean;
  sentGmailMessageId: string | null;
  sentAt: string;
}

export interface KnowledgeBuildStatus {
  running: boolean;
  stage: string | null;
  lastResult: KnowledgeBuildResult | null;
  lastError: string | null;
  configured: boolean;
  counts: { canonical: number; example: number; policy: number; unembedded: number };
  hasTone: boolean;
}
