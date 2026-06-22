import { google } from "googleapis";
import { and, desc, eq } from "drizzle-orm";
import {
  drafts,
  messages,
  sends,
  threads,
  type Db,
  type Send,
} from "@ms/db";
import type { IntegrationsConfig } from "./config";
import {
  getAuthorizedClient,
  loadGmailTokens,
  tokensHaveSendScope,
} from "./gmail-oauth";
import { extractEmail } from "./parse";

// The ONLY place in the codebase that sends email. Kept small and obviously
// auditable (spec §3, §11). A send happens only as the direct result of a human
// approving a specific draft — there is no auto-send anywhere.

export class GmailSendError extends Error {
  constructor(
    public reason: "not_connected" | "no_send_scope" | "no_recipient" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "GmailSendError";
  }
}

// Strip CR/LF so a header value (To/Subject/In-Reply-To/References) — all of
// which originate from attacker-controlled inbound email — cannot inject extra
// MIME headers (header-injection / SMTP smuggling).
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

// RFC 2047 encode a header value when it contains non-ASCII; always sanitized.
function encodeHeader(value: string): string {
  const clean = sanitizeHeaderValue(value);
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(clean)) {
    return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
  }
  return clean;
}

// Basic single-address validation. We only ever reply to one customer.
const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

// Keep only well-formed Message-ID tokens ("<id@host>") for In-Reply-To /
// References, dropping anything that could carry an injection.
function cleanMessageIds(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tokens = sanitizeHeaderValue(raw)
    .split(/\s+/)
    .filter((t) => /^<[^\s<>]+>$/.test(t));
  return tokens.length ? tokens.join(" ") : null;
}

function buildMime(opts: {
  from: string;
  to: string;
  subject: string;
  inReplyTo: string | null;
  references: string | null;
  body: string;
}): string {
  const headerLines = [
    `From: ${sanitizeHeaderValue(opts.from)}`,
    `To: ${sanitizeHeaderValue(opts.to)}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : null,
    opts.references ? `References: ${opts.references}` : null,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter((l): l is string => l !== null);
  // Wrap base64 body at 76 chars per MIME.
  const b64 = Buffer.from(opts.body, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  return `${headerLines.join("\r\n")}\r\n\r\n${b64}`;
}

export interface SendReplyParams {
  threadId: string;
  draftId: string;
  body: string;
  userId: string | null;
}

export interface SendReplyResult {
  send: Send;
  sentGmailMessageId: string | null;
}

export async function sendReply(
  db: Db,
  cfg: IntegrationsConfig,
  params: SendReplyParams,
): Promise<SendReplyResult> {
  // 1) Validate the draft + thread.
  const draftRows = await db
    .select()
    .from(drafts)
    .where(eq(drafts.id, params.draftId))
    .limit(1);
  const draft = draftRows[0];
  if (!draft) throw new GmailSendError("failed", "Draft not found.");
  if (draft.threadId !== params.threadId) {
    throw new GmailSendError("failed", "Draft does not belong to this thread.");
  }
  if (draft.status === "sent") {
    throw new GmailSendError("failed", "This draft has already been sent.");
  }
  // Idempotency guard: if an audit row already exists for this draft, a send
  // already went out (e.g. a prior attempt whose audit committed). Never resend.
  const priorSend = await db
    .select({ id: sends.id })
    .from(sends)
    .where(eq(sends.draftId, draft.id))
    .limit(1);
  if (priorSend[0]) {
    throw new GmailSendError("failed", "A reply has already been sent for this draft.");
  }

  const threadRows = await db
    .select({
      id: threads.id,
      subject: threads.subject,
      customerEmail: threads.customerEmail,
    })
    .from(threads)
    .where(eq(threads.id, params.threadId))
    .limit(1);
  const thread = threadRows[0];
  if (!thread) throw new GmailSendError("failed", "Thread not found.");

  // 2) Authorization + send-scope gate.
  const tokens = await loadGmailTokens(db, cfg.encryptionKey);
  if (!tokens?.refresh_token) {
    throw new GmailSendError("not_connected", "Gmail is not connected.");
  }
  if (!tokensHaveSendScope(tokens)) {
    throw new GmailSendError(
      "no_send_scope",
      "Gmail is connected read-only. Reconnect Gmail to grant send permission.",
    );
  }
  const auth = await getAuthorizedClient(db, cfg.google, cfg.encryptionKey);
  if (!auth) throw new GmailSendError("not_connected", "Gmail is not connected.");

  // 3) Threading headers from the latest inbound message (sanitized).
  const lastInbound = await db
    .select({ headers: messages.headers, fromAddress: messages.fromAddress })
    .from(messages)
    .where(and(eq(messages.threadId, params.threadId), eq(messages.direction, "inbound")))
    .orderBy(desc(messages.gmailInternalDate))
    .limit(1);
  const lh = (lastInbound[0]?.headers ?? {}) as Record<string, string>;
  const inReplyTo = cleanMessageIds(lh["message-id"]);
  const references = cleanMessageIds(
    [lh["references"], lh["message-id"]].filter(Boolean).join(" "),
  );

  const rawTo = sanitizeHeaderValue(
    thread.customerEmail ?? extractEmail(lastInbound[0]?.fromAddress ?? null) ?? "",
  );
  if (!rawTo || !EMAIL_RE.test(rawTo)) {
    throw new GmailSendError("no_recipient", "No valid recipient address for this thread.");
  }

  const cleanSubject = (thread.subject ?? "your message").replace(/^(re|fwd):\s*/i, "");
  const replySubject = `Re: ${cleanSubject}`;
  const fromHeader = `Molly & Stitch <${cfg.gmailAccount}>`;
  const mime = buildMime({
    from: fromHeader,
    to: rawTo,
    subject: replySubject,
    inReplyTo,
    references,
    body: params.body,
  });
  const raw = Buffer.from(mime, "utf8").toString("base64url");

  // 4) Atomically CLAIM the draft (pending → approved). The conditional update
  // succeeds for exactly one caller, so concurrent approve-send requests can't
  // both proceed. The claim is committed BEFORE the external Gmail call so we
  // never hold a row lock across the network or roll back a delivered email.
  const claimed = await db
    .update(drafts)
    .set({ status: "approved", body: params.body, updatedAt: new Date() })
    .where(and(eq(drafts.id, draft.id), eq(drafts.status, "pending")))
    .returning({ id: drafts.id });
  if (claimed.length === 0) {
    throw new GmailSendError(
      "failed",
      "This draft can't be sent right now (already sent or in progress).",
    );
  }

  // 5) Send OUTSIDE any transaction. On failure, release the claim back to
  // pending so the operator can retry; the email never went out.
  const gmail = google.gmail({ version: "v1", auth });
  let sentId: string | null = null;
  try {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId: thread.id },
    });
    sentId = res.data.id ?? null;
  } catch (err) {
    await db
      .update(drafts)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(drafts.id, draft.id));
    const msg = err instanceof Error ? err.message : String(err);
    throw new GmailSendError("failed", `Gmail send failed: ${msg}`);
  }

  // 6) The email is delivered — now record it durably. The draft stays
  // "approved" (claimed, not pending) so a crash here can never trigger a
  // resend; the priorSend guard above also blocks a retry once the audit lands.
  if (sentId) {
    await db
      .insert(messages)
      .values({
        id: sentId,
        threadId: thread.id,
        direction: "outbound",
        fromAddress: fromHeader,
        toAddress: rawTo,
        subject: replySubject,
        bodyText: params.body,
        bodyHtml: null,
        headers: inReplyTo ? { "in-reply-to": inReplyTo } : {},
        gmailInternalDate: new Date(),
        raw: null,
      })
      .onConflictDoNothing({ target: messages.id });
  }

  const sendRows = await db
    .insert(sends)
    .values({
      draftId: draft.id,
      threadId: thread.id,
      sentGmailMessageId: sentId,
      bodySnapshot: params.body,
      approvedByUserId: params.userId,
    })
    .returning();

  await db
    .update(drafts)
    .set({ status: "sent", updatedAt: new Date() })
    .where(eq(drafts.id, draft.id));
  await db
    .update(threads)
    .set({ status: "sent", updatedAt: new Date() })
    .where(eq(threads.id, thread.id));

  return { send: sendRows[0]!, sentGmailMessageId: sentId };
}

// Fetch the raw bytes of an attachment via the read-only Gmail client. Kept here
// alongside the other Gmail client usage. READ-ONLY (gmail.readonly suffices).
export async function fetchAttachmentBytes(
  db: Db,
  cfg: IntegrationsConfig,
  messageId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  const auth = await getAuthorizedClient(db, cfg.google, cfg.encryptionKey);
  if (!auth) return null;
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });
  const data = res.data.data;
  if (!data) return null;
  return Buffer.from(data, "base64url");
}
