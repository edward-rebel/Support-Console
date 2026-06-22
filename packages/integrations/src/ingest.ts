import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { eq, sql } from "drizzle-orm";
import { messages, syncState, threads, type Db } from "@ms/db";
import type { SyncResultDTO } from "@ms/shared";
import type { IntegrationsConfig } from "./config";
import { getAuthorizedClient } from "./gmail-oauth";
import {
  extractEmail,
  extractName,
  makeSnippet,
  parseGmailMessage,
  type ParsedMessage,
} from "./parse";

const PAGE_SIZE = 100;
const FETCH_CONCURRENCY = 5;

// Run N async tasks with bounded concurrency, preserving result order.
async function pooledMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index] as T);
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    worker,
  );
  await Promise.all(workers);
  return results;
}

async function getOrCreateSyncState(db: Db) {
  const rows = await db.select().from(syncState).limit(1);
  const existing = rows[0];
  if (existing) return existing;
  const inserted = await db.insert(syncState).values({}).returning();
  return inserted[0]!;
}

// Idempotent message insert keyed on the Gmail message id. Returns true if a new
// row was inserted (false if it already existed). NEVER sends anything.
async function upsertMessage(
  db: Db,
  parsed: ParsedMessage,
  raw: gmail_v1.Schema$Message,
  gmailAccount: string,
): Promise<boolean> {
  const fromEmail = extractEmail(parsed.fromAddress);
  const direction =
    fromEmail && fromEmail === gmailAccount.toLowerCase()
      ? "outbound"
      : "inbound";

  const inserted = await db
    .insert(messages)
    .values({
      id: parsed.id,
      threadId: parsed.threadId,
      direction,
      fromAddress: parsed.fromAddress,
      toAddress: parsed.toAddress,
      subject: parsed.subject,
      bodyText: parsed.bodyText,
      bodyHtml: parsed.bodyHtml,
      headers: parsed.headers,
      gmailInternalDate: parsed.internalDate,
      raw: raw as unknown,
      attachments: parsed.attachments.length ? parsed.attachments : null,
    })
    .onConflictDoNothing({ target: messages.id })
    .returning({ id: messages.id });

  return inserted.length > 0;
}

// Upsert the thread row, merging so first-seen non-null values are kept and
// lastMessageAt always advances to the newest message.
async function upsertThread(
  db: Db,
  parsed: ParsedMessage,
  gmailAccount: string,
): Promise<boolean> {
  const fromEmail = extractEmail(parsed.fromAddress);
  const isInbound = !(fromEmail && fromEmail === gmailAccount.toLowerCase());

  // The customer is the non-operator party.
  const customerEmail = isInbound
    ? fromEmail
    : extractEmail(parsed.toAddress);
  const customerName = isInbound ? extractName(parsed.fromAddress) : null;
  const cleanSubject = parsed.subject?.replace(/^(re|fwd):\s*/i, "") ?? null;
  const snippet = isInbound
    ? makeSnippet(parsed.bodyText, parsed.subject)
    : null;
  // Pass dates into raw sql fragments as ISO strings (with an explicit cast),
  // not Date objects — the postgres driver can't serialize a bare Date when
  // there's no column type to infer from inside greatest()/coalesce().
  const lastAtIso = parsed.internalDate
    ? parsed.internalDate.toISOString()
    : null;

  const inserted = await db
    .insert(threads)
    .values({
      id: parsed.threadId,
      subject: cleanSubject,
      customerEmail: customerEmail ?? null,
      customerName: customerName ?? null,
      lastMessageAt: parsed.internalDate,
      status: "new",
      snippet,
    })
    .onConflictDoUpdate({
      target: threads.id,
      set: {
        subject: sql`coalesce(${threads.subject}, ${cleanSubject})`,
        customerEmail: sql`coalesce(${threads.customerEmail}, ${customerEmail ?? null})`,
        customerName: sql`coalesce(${threads.customerName}, ${customerName ?? null})`,
        snippet: sql`coalesce(${snippet}, ${threads.snippet})`,
        lastMessageAt: sql`greatest(${threads.lastMessageAt}, ${lastAtIso}::timestamptz)`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: threads.id });

  // returning always yields the row (insert or update); detect "new" separately.
  void inserted;
  return isInbound;
}

// Ingest entire threads (not just discovered message ids): for each thread we
// fetch threads.get(full) and upsert EVERY message in it, so a thread is never
// partially ingested even if only one of its messages surfaced in list/history.
// Idempotent — re-walking a thread upserts on conflict and never duplicates.
async function ingestThreadIds(
  db: Db,
  gmail: gmail_v1.Gmail,
  threadIds: string[],
  gmailAccount: string,
): Promise<{ threadsUpserted: number; messagesUpserted: number }> {
  let messagesUpserted = 0;
  let threadsUpserted = 0;

  const threadsData = await pooledMap(threadIds, FETCH_CONCURRENCY, (id) =>
    fetchThread(gmail, id),
  );

  for (const t of threadsData) {
    if (!t?.messages?.length) continue;
    let threadHadNew = false;
    for (const raw of t.messages) {
      const parsed = parseGmailMessage(raw);
      if (!parsed) continue;
      await upsertThread(db, parsed, gmailAccount);
      const isNew = await upsertMessage(db, parsed, raw, gmailAccount);
      if (isNew) {
        messagesUpserted++;
        threadHadNew = true;
      }
    }
    if (threadHadNew) threadsUpserted++;
  }

  return { threadsUpserted, messagesUpserted };
}

async function fetchThread(
  gmail: gmail_v1.Gmail,
  id: string,
): Promise<gmail_v1.Schema$Thread | null> {
  const res = await gmail.users.threads.get({ userId: "me", id, format: "full" });
  return res.data ?? null;
}

// One-time backfill of the last N months via messages.list (after: query).
async function runBackfill(
  db: Db,
  gmail: gmail_v1.Gmail,
  cfg: IntegrationsConfig,
  startedAt: Date,
): Promise<SyncResultDTO> {
  const afterSeconds = Math.floor(
    (Date.now() - cfg.backfillMonths * 30 * 24 * 60 * 60 * 1000) / 1000,
  );
  const query = `after:${afterSeconds}`;

  let pageToken: string | undefined;
  let latestHistoryId: string | null = null;
  // Collect distinct thread ids across all pages, then walk each thread once.
  const threadIds = new Set<string>();

  do {
    const list = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: PAGE_SIZE,
      pageToken,
    });
    for (const m of list.data.messages ?? []) {
      if (m.threadId) threadIds.add(m.threadId);
    }
    pageToken = list.data.nextPageToken ?? undefined;
  } while (pageToken);

  const r = await ingestThreadIds(db, gmail, [...threadIds], cfg.gmailAccount);
  const totalThreads = r.threadsUpserted;
  const totalMessages = r.messagesUpserted;

  // Capture the mailbox's current historyId so incremental sync can resume.
  const profile = await gmail.users.getProfile({ userId: "me" });
  latestHistoryId = profile.data.historyId ?? null;

  const finishedAt = new Date();
  await db
    .update(syncState)
    .set({
      lastHistoryId: latestHistoryId,
      lastFullSyncAt: finishedAt,
      lastIncrementalSyncAt: finishedAt,
      updatedAt: finishedAt,
    })
    .where(eq(syncState.id, (await getOrCreateSyncState(db)).id));

  return {
    ok: true,
    mode: "backfill",
    threadsUpserted: totalThreads,
    messagesUpserted: totalMessages,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}

// Incremental sync via the History API from the stored historyId.
async function runIncremental(
  db: Db,
  gmail: gmail_v1.Gmail,
  cfg: IntegrationsConfig,
  startHistoryId: string,
  startedAt: Date,
): Promise<SyncResultDTO> {
  let pageToken: string | undefined;
  // Collect the threads touched by new messages and walk each fully.
  const threadIds = new Set<string>();
  let latestHistoryId = startHistoryId;

  try {
    do {
      const res = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
        maxResults: 500,
        pageToken,
      });
      for (const h of res.data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          const tid = added.message?.threadId;
          if (tid) threadIds.add(tid);
        }
      }
      if (res.data.historyId) latestHistoryId = res.data.historyId;
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (err: unknown) {
    // A 404 means the stored historyId is too old (expired). Fall back to a
    // full backfill, which is still idempotent.
    const status = (err as { code?: number; status?: number })?.code ??
      (err as { status?: number })?.status;
    if (status === 404) {
      return runBackfill(db, gmail, cfg, startedAt);
    }
    throw err;
  }

  let totalThreads = 0;
  let totalMessages = 0;
  if (threadIds.size > 0) {
    const r = await ingestThreadIds(db, gmail, [...threadIds], cfg.gmailAccount);
    totalThreads = r.threadsUpserted;
    totalMessages = r.messagesUpserted;
  }

  const finishedAt = new Date();
  await db
    .update(syncState)
    .set({
      lastHistoryId: latestHistoryId,
      lastIncrementalSyncAt: finishedAt,
      updatedAt: finishedAt,
    })
    .where(eq(syncState.id, (await getOrCreateSyncState(db)).id));

  return {
    ok: true,
    mode: "incremental",
    threadsUpserted: totalThreads,
    messagesUpserted: totalMessages,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}

export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail is not connected. Complete the OAuth flow first.");
    this.name = "GmailNotConnectedError";
  }
}

// Public entry point. Chooses backfill vs incremental based on stored state.
// This is the ONLY ingestion entry point; it never sends email.
export async function runSync(
  db: Db,
  cfg: IntegrationsConfig,
): Promise<SyncResultDTO> {
  const auth: OAuth2Client | null = await getAuthorizedClient(
    db,
    cfg.google,
    cfg.encryptionKey,
  );
  if (!auth) throw new GmailNotConnectedError();

  const gmail = google.gmail({ version: "v1", auth });
  const state = await getOrCreateSyncState(db);
  const startedAt = new Date();

  if (!state.lastHistoryId) {
    return runBackfill(db, gmail, cfg, startedAt);
  }
  return runIncremental(db, gmail, cfg, state.lastHistoryId, startedAt);
}
