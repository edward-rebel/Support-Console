import type { gmail_v1 } from "googleapis";

// Pulls the fields we store from a full Gmail message payload. Pure function —
// operates on the raw payload so it can be re-run from stored data (spec §3.4).

export interface ParsedAttachment {
  attachmentId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  inline: boolean;
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  fromAddress: string | null;
  toAddress: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  headers: Record<string, string>;
  internalDate: Date | null;
  attachments: ParsedAttachment[];
}

const KEEP_HEADERS = new Set([
  "message-id",
  "in-reply-to",
  "references",
  "from",
  "to",
  "subject",
  "date",
]);

function decodeBody(data: string | null | undefined): string | null {
  if (!data) return null;
  // Gmail uses base64url.
  return Buffer.from(data, "base64url").toString("utf8");
}

function collectHeaders(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers ?? []) {
    const name = h.name?.toLowerCase();
    if (name && h.value != null && KEEP_HEADERS.has(name)) {
      out[name] = h.value;
    }
  }
  return out;
}

function partHeader(
  part: gmail_v1.Schema$MessagePart,
  name: string,
): string | null {
  const h = part.headers?.find((x) => x.name?.toLowerCase() === name);
  return h?.value ?? null;
}

// Walk the MIME tree collecting the first text/plain and text/html bodies plus
// any attachment parts (anything with a filename / attachment disposition).
function walkParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: { text: string | null; html: string | null; attachments: ParsedAttachment[] },
): void {
  if (!part) return;
  const mime = part.mimeType ?? "";
  const filename = part.filename ?? "";
  const disposition = (partHeader(part, "content-disposition") ?? "").toLowerCase();
  const hasAttachmentBody = Boolean(part.body?.attachmentId);

  // Classify by disposition/attachment-body FIRST (not filename): a downloadable
  // part is an attachment; otherwise it may still be the readable body even if a
  // client tacked a filename onto it, so we must not drop it.
  const isAttachment = hasAttachmentBody || disposition.includes("attachment");
  if (isAttachment) {
    const inline =
      disposition.startsWith("inline") ||
      (!disposition && mime.startsWith("image/") && Boolean(partHeader(part, "content-id")));
    acc.attachments.push({
      attachmentId: part.body?.attachmentId ?? null,
      filename: filename || mime || "attachment",
      mimeType: mime || "application/octet-stream",
      size: part.body?.size ?? 0,
      inline,
    });
  } else if (mime === "text/plain" && acc.text == null) {
    acc.text = decodeBody(part.body?.data);
  } else if (mime === "text/html" && acc.html == null) {
    acc.html = decodeBody(part.body?.data);
  }
  for (const child of part.parts ?? []) {
    walkParts(child, acc);
  }
}

export function parseGmailMessage(
  message: gmail_v1.Schema$Message,
): ParsedMessage | null {
  if (!message.id || !message.threadId) return null;
  const headers = collectHeaders(message.payload?.headers);
  const acc: {
    text: string | null;
    html: string | null;
    attachments: ParsedAttachment[];
  } = {
    text: null,
    html: null,
    attachments: [],
  };
  walkParts(message.payload, acc);

  const internalMs = message.internalDate
    ? Number(message.internalDate)
    : null;

  return {
    id: message.id,
    threadId: message.threadId,
    fromAddress: headers["from"] ?? null,
    toAddress: headers["to"] ?? null,
    subject: headers["subject"] ?? null,
    bodyText: acc.text,
    bodyHtml: acc.html,
    headers,
    internalDate:
      internalMs != null && Number.isFinite(internalMs)
        ? new Date(internalMs)
        : null,
    attachments: acc.attachments,
  };
}

// Extract a bare email address from a "Name <email@x.com>" header value.
export function extractEmail(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/<([^>]+)>/);
  const raw = (match?.[1] ?? headerValue).trim();
  return raw.toLowerCase() || null;
}

// Extract a display name from a "Name <email>" header value.
export function extractName(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/^\s*"?([^"<]*?)"?\s*</);
  const name = match?.[1]?.trim();
  return name && name.length > 0 ? name : null;
}

// A short single-line snippet from the plain-text body.
export function makeSnippet(
  bodyText: string | null,
  fallback: string | null,
): string | null {
  const source = bodyText ?? fallback;
  if (!source) return null;
  return source.replace(/\s+/g, " ").trim().slice(0, 180) || null;
}
