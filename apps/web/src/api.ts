import type {
  KnowledgeBuildStatus,
  KnowledgeEntryDTO,
  KnowledgeEntryType,
  OperatorDTO,
  Paginated,
  ShopifyContextDTO,
  SyncResultDTO,
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
  account: string;
  configured: boolean;
}
export interface SyncStatus {
  syncing: boolean;
  lastResult: SyncResultDTO | null;
  lastError: string | null;
}

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
      page?: number;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.tab) qs.set("tab", params.tab);
    if (params.category) qs.set("category", params.category);
    if (params.page) qs.set("page", String(params.page));
    const q = qs.toString();
    return request<Paginated<ThreadSummaryDTO>>(
      `/threads${q ? `?${q}` : ""}`,
    );
  },
  threadCounts: () =>
    request<{
      customer: number;
      noise: number;
      pending: number;
      needsReview: number;
    }>("/threads/counts"),
  getThread: (id: string) => request<ThreadDetailDTO>(`/threads/${id}`),
  reclassifyThread: (id: string, isCustomer: boolean) =>
    request<{ isCustomer: boolean | null }>(`/threads/${id}/reclassify`, {
      method: "POST",
      body: JSON.stringify({ isCustomer }),
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

  // ── Shopify (read-only) ───────────────────────────────────────────────────
  shopifyStatus: () =>
    request<{ configured: boolean; store: string | null }>("/shopify/status"),
  shopifyContext: (params: { email?: string; order?: string }) => {
    const qs = new URLSearchParams();
    if (params.email) qs.set("email", params.email);
    if (params.order) qs.set("order", params.order);
    return request<ShopifyContextDTO>(`/shopify/context?${qs.toString()}`);
  },
};
