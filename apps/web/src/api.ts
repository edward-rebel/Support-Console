import type {
  DraftDTO,
  FeedbackDTO,
  FeedbackStatus,
  InsightsDTO,
  KnowledgeBuildStatus,
  KnowledgeEntryDTO,
  KnowledgeEntryType,
  OperatorDTO,
  Paginated,
  SendResultDTO,
  ShopifyContextDTO,
  SyncStatusDTO,
  ThreadDetailDTO,
  ThreadSummaryDTO,
  ToneProfileDTO,
} from "@ms/shared";

// Empty default = same-origin (combined-service deployment). Local dev sets
// VITE_API_URL to the standalone API origin via apps/web/.env.development.
const API_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when we actually send a body — otherwise
  // Fastify's JSON parser rejects the empty body (e.g. POST /sync, /logout).
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (init?.body != null) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface SenderRuleDTO {
  id: string;
  pattern: string;
  rule: "allow" | "block";
  note: string | null;
}

export interface GmailStatus {
  connected: boolean;
  canSend: boolean;
  account: string;
  configured: boolean;
}

export class SendBlockedError extends ApiError {
  constructor(
    status: number,
    message: string,
    public reason: string,
  ) {
    super(status, message);
    this.name = "SendBlockedError";
  }
}
export type SyncStatus = SyncStatusDTO;

export const api = {
  login: (email: string, password: string) =>
    request<OperatorDTO>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => request<OperatorDTO>("/auth/me"),
  listThreads: (
    params: {
      status?: string;
      tab?: "customer" | "noise";
      category?: string;
      q?: string;
      page?: number;
      sort?: "newest" | "oldest";
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.tab) qs.set("tab", params.tab);
    if (params.category) qs.set("category", params.category);
    if (params.q) qs.set("q", params.q);
    if (params.page) qs.set("page", String(params.page));
    if (params.sort) qs.set("sort", params.sort);
    const query = qs.toString();
    return request<Paginated<ThreadSummaryDTO>>(
      `/threads${query ? `?${query}` : ""}`,
    );
  },
  getInsights: (range?: string) =>
    request<InsightsDTO>(`/insights${range ? `?range=${range}` : ""}`),
  attachmentUrl: (messageId: string, attachmentId: string) =>
    `${API_URL}/messages/${messageId}/attachments/${attachmentId}`,
  threadCounts: () =>
    request<{
      customer: number;
      noise: number;
      pending: number;
      open: number;
      needsReview: number;
    }>("/threads/counts"),
  getThread: (id: string) => request<ThreadDetailDTO>(`/threads/${id}`),
  reclassifyThread: (id: string, isCustomer: boolean) =>
    request<{ isCustomer: boolean | null }>(`/threads/${id}/reclassify`, {
      method: "POST",
      body: JSON.stringify({ isCustomer }),
    }),
  // Manually close a request (no reply sent) / reopen it to the Open queue.
  closeThread: (id: string) =>
    request<{ ok: boolean; status: string }>(`/threads/${id}/close`, {
      method: "POST",
    }),
  // Bulk-close several threads at once (inbox multi-select).
  closeThreads: (ids: string[]) =>
    request<{ ok: boolean; closed: number }>(`/threads/close`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  reopenThread: (id: string) =>
    request<{ ok: boolean; status: string }>(`/threads/${id}/reopen`, {
      method: "POST",
    }),
  runTriage: () =>
    request<{ started: boolean; running: boolean }>("/triage/run", {
      method: "POST",
    }),
  listSenderRules: () => request<SenderRuleDTO[]>("/sender-rules"),
  addSenderRule: (pattern: string, rule: "allow" | "block", note?: string) =>
    request<SenderRuleDTO>("/sender-rules", {
      method: "POST",
      body: JSON.stringify({ pattern, rule, note }),
    }),
  deleteSenderRule: (id: string) =>
    request<{ ok: boolean }>(`/sender-rules/${id}`, { method: "DELETE" }),
  sync: () =>
    request<{ started: boolean } & SyncStatus>("/sync", { method: "POST" }),
  syncStatus: () => request<SyncStatus>("/sync/status"),
  gmailStatus: () => request<GmailStatus>("/auth/gmail/status"),
  gmailConnectUrl: () => `${API_URL}/auth/google`,

  // ── Knowledge base (Phase 2) ──────────────────────────────────────────────
  listKnowledge: (params: { type?: KnowledgeEntryType; category?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.type) qs.set("type", params.type);
    if (params.category) qs.set("category", params.category);
    const q = qs.toString();
    return request<KnowledgeEntryDTO[]>(`/knowledge${q ? `?${q}` : ""}`);
  },
  knowledgeStatus: () => request<KnowledgeBuildStatus>("/knowledge/build/status"),
  buildKnowledge: () =>
    request<{ started: boolean } & KnowledgeBuildStatus>("/knowledge/build", {
      method: "POST",
    }),
  getTone: () => request<ToneProfileDTO | null>("/knowledge/tone"),
  saveTone: (content: string) =>
    request<{ ok: boolean }>("/knowledge/tone", {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  createKnowledge: (entry: {
    type: KnowledgeEntryType;
    categorySlug?: string;
    question?: string;
    answer: string;
  }) =>
    request<{ id: string }>("/knowledge", {
      method: "POST",
      body: JSON.stringify(entry),
    }),
  updateKnowledge: (
    id: string,
    patch: { question?: string; answer?: string; isActive?: boolean },
  ) =>
    request<{ ok: boolean }>(`/knowledge/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteKnowledge: (id: string) =>
    request<{ ok: boolean }>(`/knowledge/${id}`, { method: "DELETE" }),

  // ── Drafting + send (Phase 3) ─────────────────────────────────────────────
  getDraft: (threadId: string) =>
    request<DraftDTO | null>(`/threads/${threadId}/draft`),
  generateDraft: (threadId: string) =>
    request<DraftDTO>(`/threads/${threadId}/draft`, { method: "POST" }),
  updateDraft: (draftId: string, body: string) =>
    request<DraftDTO>(`/drafts/${draftId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }),
  dismissDraft: (draftId: string) =>
    request<DraftDTO>(`/drafts/${draftId}/dismiss`, { method: "POST" }),
  // Guarded send. Surfaces a SendBlockedError (with reason) on 412 so the UI can
  // prompt the operator to reconnect Gmail with send permission.
  approveSend: async (draftId: string, body?: string): Promise<SendResultDTO> => {
    const res = await fetch(`${API_URL}/drafts/${draftId}/approve-send`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ? { body } : {}),
    });
    if (!res.ok) {
      let message = res.statusText;
      let reason = "failed";
      try {
        const b = (await res.json()) as { error?: string; reason?: string };
        if (b.error) message = b.error;
        if (b.reason) reason = b.reason;
      } catch {
        /* non-JSON */
      }
      if (res.status === 412) throw new SendBlockedError(res.status, message, reason);
      throw new ApiError(res.status, message);
    }
    return (await res.json()) as SendResultDTO;
  },
  // Manual operator-authored follow-up reply (after a thread was already
  // replied to). Same guarded send path + 412 → SendBlockedError handling.
  sendManualReply: async (threadId: string, body: string): Promise<SendResultDTO> => {
    const res = await fetch(`${API_URL}/threads/${threadId}/reply`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      let message = res.statusText;
      let reason = "failed";
      try {
        const b = (await res.json()) as { error?: string; reason?: string };
        if (b.error) message = b.error;
        if (b.reason) reason = b.reason;
      } catch {
        /* non-JSON */
      }
      if (res.status === 412) throw new SendBlockedError(res.status, message, reason);
      throw new ApiError(res.status, message);
    }
    return (await res.json()) as SendResultDTO;
  },

  // ── Feedback ──────────────────────────────────────────────────────────────
  submitFeedback: (message: string, page: string) =>
    request<FeedbackDTO>("/feedback", {
      method: "POST",
      body: JSON.stringify({ message, page }),
    }),
  listFeedback: (status?: string) =>
    request<FeedbackDTO[]>(`/feedback${status ? `?status=${status}` : ""}`),
  feedbackCounts: () =>
    request<{ open: number; total: number }>("/feedback/counts"),
  updateFeedback: (id: string, status: FeedbackStatus) =>
    request<FeedbackDTO>(`/feedback/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  deleteFeedback: (id: string) =>
    request<{ ok: boolean }>(`/feedback/${id}`, { method: "DELETE" }),

  // ── Shopify (read-only) ───────────────────────────────────────────────────
  shopifyStatus: () =>
    request<{ configured: boolean; store: string | null }>("/shopify/status"),
  // Thread-scoped: resolves pinned order → email → order # in subject/body, and
  // persists a resolved order so it survives a reload.
  threadShopify: (threadId: string) =>
    request<ShopifyContextDTO>(`/threads/${threadId}/shopify`),
  // Manual lookup for a thread by email, name, phone, or order # — pins the order.
  threadShopifyOrder: (threadId: string, query: string) =>
    request<ShopifyContextDTO>(`/threads/${threadId}/shopify/order`, {
      method: "POST",
      body: JSON.stringify({ query }),
    }),
};
