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

// RFC 2047 encode a header value if it contains non-ASCII characters.
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(value)) {
    return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
  }
  return value;
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
    `From: ${opts.from}`,
    `To: ${opts.to}`,
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

  // 3) Threading headers from the latest inbound message.
  const lastInbound = await db
    .select({ headers: messages.headers, fromAddress: messages.fromAddress })
    .from(messages)
    .where(and(eq(messages.threadId, params.threadId), eq(messages.direction, "inbound")))
    .orderBy(desc(messages.gmailInternalDate))
    .limit(1);
  const lh = (lastInbound[0]?.headers ?? {}) as Record<string, string>;
  const inReplyTo = lh["message-id"] ?? null;
  const references =
    [lh["references"], lh["message-id"]].filter(Boolean).join(" ").trim() || null;

  const to =
    thread.customerEmail ?? extractEmail(lastInbound[0]?.fromAddress ?? null);
  if (!to) {
    throw new GmailSendError("no_recipient", "No recipient address for this thread.");
  }

  const cleanSubject = (thread.subject ?? "your message").replace(/^(re|fwd):\s*/i, "");
  const mime = buildMime({
    from: `Molly & Stitch <${cfg.gmailAccount}>`,
    to,
    subject: `Re: ${cleanSubject}`,
    inReplyTo,
    references,
    body: params.body,
  });
  const raw = Buffer.from(mime, "utf8").toString("base64url");

  // 4) Send on the original Gmail thread.
  const gmail = google.gmail({ version: "v1", auth });
  let sentId: string | null = null;
  try {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId: thread.id },
    });
    sentId = res.data.id ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GmailSendError("failed", `Gmail send failed: ${msg}`);
  }

  // 5) Immutable audit row + status updates.
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
    .set({ status: "sent", body: params.body, updatedAt: new Date() })
    .where(eq(drafts.id, draft.id));
  await db
    .update(threads)
    .set({ status: "sent", updatedAt: new Date() })
    .where(eq(threads.id, thread.id));

  return { send: sendRows[0]!, sentGmailMessageId: sentId };
}
