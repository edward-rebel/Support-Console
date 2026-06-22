import type {
  ConfidenceLevel,
  KnowledgeEntryType,
  MessageDirection,
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
  unread: boolean;
  snippet: string | null;
  lastMessageAt: string | null;
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
}

export interface ThreadDetailDTO extends ThreadSummaryDTO {
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

export interface ShopifyContextDTO {
  found: boolean;
  customer: ShopifyCustomerDTO | null;
  orders: ShopifyOrderDTO[];
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
