import type {
  OperatorDTO,
  Paginated,
  SyncResultDTO,
  ThreadDetailDTO,
  ThreadSummaryDTO,
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
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
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
  listThreads: (params: { status?: string; page?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.page) qs.set("page", String(params.page));
    const q = qs.toString();
    return request<Paginated<ThreadSummaryDTO>>(
      `/threads${q ? `?${q}` : ""}`,
    );
  },
  getThread: (id: string) => request<ThreadDetailDTO>(`/threads/${id}`),
  sync: () =>
    request<{ started: boolean } & SyncStatus>("/sync", { method: "POST" }),
  syncStatus: () => request<SyncStatus>("/sync/status"),
  gmailStatus: () => request<GmailStatus>("/auth/gmail/status"),
  gmailConnectUrl: () => `${API_URL}/auth/google`,
};
