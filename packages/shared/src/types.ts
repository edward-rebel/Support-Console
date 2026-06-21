import type {
  ConfidenceLevel,
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
