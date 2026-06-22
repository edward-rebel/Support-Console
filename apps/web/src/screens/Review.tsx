import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DOMPurify from "dompurify";
import type {
  AttachmentDTO,
  ConfidenceLevel,
  DraftDTO,
  MessageDTO,
  ShopifyContextDTO,
  ShopifyOrderDTO,
  ThreadDetailDTO,
} from "@ms/shared";
import { api, SendBlockedError } from "../api";
import { useIsMobile } from "../useIsMobile";
import { ChevronLeftIcon, BagIcon } from "../icons";
import {
  avatarTokens,
  categoryTokens,
  confColor,
  initialsFrom,
  sentimentLabel,
  sentimentTokens,
} from "../tokens";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "script", "iframe", "link", "meta", "head", "title", "form", "input", "button", "object", "embed", "svg"],
    FORBID_ATTR: ["style", "class", "width", "height", "align", "bgcolor", "background", "srcset"],
    ALLOW_DATA_ATTR: false,
  });
}

// Split a plain-text body into the visible reply and the quoted history that
// follows, so long "On … wrote:" / ">" chains collapse behind a toggle.
function splitQuoted(text: string): { visible: string; quoted: string } {
  const markers = [
    /\n[>\s]*On .+wrote:/,
    /\n-----+ ?Original Message ?-----+/i,
    /\n_{10,}/,
    /\nFrom:\s.+\nSent:/i,
    /\nGet Outlook for/i,
  ];
  let cut = text.length;
  for (const m of markers) {
    const idx = text.search(m);
    if (idx > 40 && idx < cut) cut = idx;
  }
  // First run of quoted ">" lines.
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim().startsWith(">")) {
      const idx = lines.slice(0, i).join("\n").length;
      if (idx > 40 && idx < cut) cut = idx;
      break;
    }
  }
  const visible = text.slice(0, cut).trim();
  const quoted = visible ? text.slice(cut).trim() : "";
  return { visible: visible || text.trim(), quoted };
}

function parseAddress(raw: string | null): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: (m[1] ?? "").trim() || null, email: (m[2] ?? "").trim() || null };
  if (raw.includes("@")) return { name: null, email: raw.trim() };
  return { name: raw.trim() || null, email: null };
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function dayLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hasBody(msg: MessageDTO): boolean {
  return Boolean(msg.bodyText?.trim() || msg.bodyHtml?.trim() || msg.attachments.length);
}

function AttachmentChips({ items }: { items: AttachmentDTO[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 11 }}>
      {items.map((a, i) => {
        const downloadable = Boolean(a.id);
        const chip = (
          <>
            <span style={{ fontSize: 13 }}>📎</span>
            <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {a.filename}
            </span>
            <span style={{ color: "var(--text-3)" }}>{fileSize(a.size)}</span>
          </>
        );
        const style: React.CSSProperties = {
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          fontSize: 12,
          padding: "5px 10px",
          borderRadius: 8,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          color: "var(--text-2)",
          textDecoration: "none",
        };
        return downloadable ? (
          <a key={a.id} href={api.attachmentUrl(a.messageId, a.id)} target="_blank" rel="noreferrer" style={style}>
            {chip}
          </a>
        ) : (
          <span key={`${a.messageId}:${a.filename}:${i}`} style={style}>{chip}</span>
        );
      })}
    </div>
  );
}

function MessageBody({ msg }: { msg: MessageDTO }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const text = msg.bodyText?.trim();
  if (text) {
    const { visible, quoted } = splitQuoted(text);
    return (
      <>
        <div className="email-text">{visible}</div>
        {quoted && (
          <>
            <button
              onClick={() => setShowQuoted((s) => !s)}
              style={{ marginTop: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-3)" }}
            >
              {showQuoted ? "Hide quoted history" : "••• Show quoted history"}
            </button>
            {showQuoted && (
              <div className="email-text" style={{ marginTop: 8, color: "var(--text-3)", borderLeft: "2px solid var(--border)", paddingLeft: 12 }}>
                {quoted}
              </div>
            )}
          </>
        )}
      </>
    );
  }
  if (msg.bodyHtml?.trim()) {
    return <div className="email-html" dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(msg.bodyHtml) }} />;
  }
  if (msg.attachments.length) {
    return <div style={{ fontSize: 13, color: "var(--text-3)", fontStyle: "italic" }}>(Attachment only — no message text.)</div>;
  }
  return <div style={{ fontSize: 13, color: "var(--text-3)", fontStyle: "italic" }}>(This message has no readable text content.)</div>;
}

function MessageCard({ msg, fallbackName }: { msg: MessageDTO; fallbackName: string | null }) {
  const outbound = msg.direction === "outbound";
  const addr = parseAddress(msg.fromAddress);
  const name = outbound ? addr.name ?? "Molly & Stitch" : addr.name ?? fallbackName ?? addr.email ?? "Customer";
  const av = avatarTokens(addr.email ?? name);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${outbound ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 12,
        background: outbound ? "var(--accent-soft-bg)" : "var(--surface)",
        padding: "13px 15px",
        marginBottom: 12,
        marginLeft: outbound ? "8%" : 0,
        marginRight: outbound ? 0 : "8%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ flex: "none", width: 30, height: 30, borderRadius: "50%", background: outbound ? "var(--accent)" : av.bg, color: outbound ? "var(--accent-fg)" : av.fg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 12 }}>
          {outbound ? "MS" : initialsFrom(name, addr.email)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text)" }}>{name}</span>
            {outbound && (
              <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--accent-soft-fg)" }}>Sent</span>
            )}
            {addr.email && (
              <span style={{ fontSize: 11.5, color: "var(--text-3)", fontFamily: "var(--mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {addr.email}
              </span>
            )}
          </div>
        </div>
        <span style={{ flex: "none", fontSize: 12, color: "var(--text-3)" }}>{formatTime(msg.gmailInternalDate)}</span>
      </div>
      <MessageBody msg={msg} />
      <AttachmentChips items={msg.attachments} />
    </div>
  );
}

export function Review() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [thread, setThread] = useState<ThreadDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reclassifying, setReclassifying] = useState(false);
  const [draft, setDraft] = useState<DraftDTO | null>(null);
  const [draftLoading, setDraftLoading] = useState(true);
  const [canSend, setCanSend] = useState(false);
  const [mobileTab, setMobileTab] = useState<"conversation" | "context">("conversation");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const reclassify = async (isCustomer: boolean) => {
    if (!id || reclassifying) return;
    setReclassifying(true);
    try {
      await api.reclassifyThread(id, isCustomer);
      navigate("/inbox");
    } catch {
      setReclassifying(false);
    }
  };

  // Re-pull the thread after a send so the just-sent outbound message shows up
  // in the conversation immediately (the send-bottom scroll effect then brings
  // it into view). Without this the customer gets the reply but it doesn't
  // appear here until the thread is reopened.
  const refreshThread = async () => {
    if (!id) return;
    try {
      const t = await api.getThread(id);
      setThread(t);
    } catch {
      /* keep the current view on a transient refresh failure */
    }
  };

  useEffect(() => {
    if (!id) return;
    let active = true;
    // Reset per-thread state so navigating review→review never bleeds the prior
    // thread's content or sticks a stale error screen.
    setThread(null);
    setError(null);
    void (async () => {
      try {
        const t = await api.getThread(id);
        if (active) setThread(t);
      } catch {
        if (active) setError("Could not load this thread.");
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setDraft(null);
    setDraftLoading(true);
    void Promise.all([
      api.getDraft(id).then((d) => active && setDraft(d)).catch(() => {}),
      api.gmailStatus().then((s) => active && setCanSend(s.canSend)).catch(() => {}),
    ]).finally(() => active && setDraftLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (thread && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread, mobileTab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate("/inbox");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  if (error) return <div style={{ padding: 40, color: "var(--text-3)" }}>{error}</div>;
  if (!thread) return <div style={{ padding: 40, color: "var(--text-3)" }}>Loading…</div>;

  const cat = categoryTokens(thread.category?.slug);
  const conversation = thread.messages.filter(hasBody);
  const shown = conversation.length > 0 ? conversation : thread.messages;
  const isSent = thread.status === "sent" || draft?.status === "sent";

  // Conversation column with day dividers.
  const conversationEl = (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        padding: isMobile ? "16px 14px" : "22px 26px",
      }}
    >
      {shown.length > 1 && (
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: "var(--text-3)", background: "var(--surface)", border: "1px solid var(--border)", padding: "3px 12px", borderRadius: 999 }}>
            {shown.length} messages in this conversation
          </span>
        </div>
      )}
      {shown.map((m, i) => {
        const prev = shown[i - 1];
        const showDay = !prev || dayLabel(prev.gmailInternalDate) !== dayLabel(m.gmailInternalDate);
        return (
          <div key={m.id}>
            {showDay && m.gmailInternalDate && (
              <div style={{ textAlign: "center", margin: "6px 0 14px" }}>
                <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.03em" }}>
                  {dayLabel(m.gmailInternalDate)}
                </span>
              </div>
            )}
            <MessageCard msg={m} fallbackName={thread.customerName} />
          </div>
        );
      })}
    </div>
  );

  const composerEl = (
    <DraftComposer
      threadId={thread.id}
      isCustomer={thread.isCustomer}
      draft={draft}
      setDraft={setDraft}
      canSend={canSend}
      loading={draftLoading}
      isSent={isSent}
      reclassifying={reclassifying}
      onReclassify={reclassify}
      onSent={() => navigate("/inbox")}
      onReplySent={refreshThread}
      isMobile={isMobile}
    />
  );

  const contextEl = (
    <div
      style={{
        flex: isMobile ? 1 : "none",
        minHeight: 0,
        width: isMobile ? "100%" : 392,
        overflow: "auto",
        padding: isMobile ? "16px 14px 24px" : "24px 22px",
        background: "var(--surface-2)",
        borderTop: "none",
      }}
    >
      <div style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 13 }}>
        Context
      </div>
      {thread.summary && <SummaryCard summary={thread.summary} />}
      {id && <ShopifyContextPanel key={id} threadId={id} email={thread.customerEmail} />}
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* header */}
      <div style={{ flex: "none", height: 60, display: "flex", alignItems: "center", gap: isMobile ? 10 : 13, padding: isMobile ? "0 14px" : "0 22px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <button
          onClick={() => navigate("/inbox")}
          aria-label="Back"
          style={{ cursor: "pointer", width: isMobile ? 40 : 32, height: isMobile ? 40 : 32, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-2)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
        >
          <ChevronLeftIcon size={16} strokeWidth={2.2} />
        </button>
        {thread.category && !isMobile && (
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.02em", padding: "3px 10px", borderRadius: 999, background: cat.bg, color: cat.fg, flex: "none" }}>
            {thread.category.name}
          </span>
        )}
        {thread.sentiment && thread.sentiment !== "neutral" && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: sentimentTokens(thread.sentiment).bg, color: sentimentTokens(thread.sentiment).fg, flex: "none", whiteSpace: "nowrap" }}>
            {sentimentLabel(thread.sentiment)}
          </span>
        )}
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
          {thread.subject ?? "(no subject)"}
        </div>
        {!isMobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "none" }}>
            <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Draft confidence</span>
            <ConfidenceDots confidence={draft?.confidence ?? null} />
          </div>
        )}
      </div>

      {/* mobile tab switch */}
      {isMobile && (
        <div style={{ flex: "none", display: "flex", gap: 4, padding: "10px 14px 0" }}>
          {(["conversation", "context"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setMobileTab(t)}
              style={{ flex: 1, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "9px 0", borderRadius: 9, border: "1px solid var(--border)", background: mobileTab === t ? "var(--accent-soft-bg)" : "var(--surface)", color: mobileTab === t ? "var(--accent-soft-fg)" : "var(--text-3)" }}
            >
              {t === "conversation" ? "Conversation" : "Order context"}
            </button>
          ))}
        </div>
      )}

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
        {(!isMobile || mobileTab === "conversation") && (
          <div style={{ flex: isMobile ? 1 : 1.62, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", borderRight: isMobile ? "none" : "1px solid var(--border)", background: "var(--surface-2)" }}>
            {conversationEl}
            {composerEl}
          </div>
        )}
        {(!isMobile || mobileTab === "context") && contextEl}
      </div>
    </div>
  );
}

function ConfidenceDots({ confidence }: { confidence: ConfidenceLevel | null }) {
  const lit = confidence === "high" ? 3 : confidence === "medium" ? 2 : confidence === "low" ? 1 : 0;
  const color = confidence ? confColor(confidence) : "var(--dot-off)";
  return (
    <>
      {[0, 1, 2].map((i) => (
        <i key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i < lit ? color : "var(--dot-off)", display: "inline-block" }} />
      ))}
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-3)" }}>{confidence ?? "—"}</span>
    </>
  );
}

function SummaryCard({ summary }: { summary: string }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 14px", marginBottom: 16 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 6 }}>
        Request
      </div>
      <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.5 }}>{summary}</div>
    </div>
  );
}

function DraftComposer({
  threadId,
  isCustomer,
  draft,
  setDraft,
  canSend,
  loading,
  isSent,
  reclassifying,
  onReclassify,
  onSent,
  onReplySent,
  isMobile,
}: {
  threadId: string;
  isCustomer: boolean | null;
  draft: DraftDTO | null;
  setDraft: (d: DraftDTO | null) => void;
  canSend: boolean;
  loading: boolean;
  isSent: boolean;
  reclassifying: boolean;
  onReclassify: (isCustomer: boolean) => void;
  onSent: () => void;
  onReplySent: () => void | Promise<void>;
  isMobile: boolean;
}) {
  const [body, setBody] = useState(draft?.body ?? "");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setBody(draft?.body ?? "");
  }, [draft?.id, draft?.body]);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const d = await api.generateDraft(threadId);
      setDraft(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate a draft.");
    } finally {
      setGenerating(false);
    }
  };
  const dismiss = async () => {
    if (!draft) return;
    try {
      await api.dismissDraft(draft.id);
      setDraft(null);
    } catch {
      /* ignore */
    }
  };
  const send = async () => {
    if (sending || !body.trim()) return;
    setSending(true);
    setError(null);
    setNeedsReconnect(false);
    try {
      // If there's an AI draft, approve-and-send it; otherwise send the
      // operator's own typed reply through the manual reply path. Both go
      // through the same single guarded server send path.
      if (draft) {
        await api.approveSend(draft.id, body);
      } else {
        await api.sendManualReply(threadId, body);
      }
      // Sent — pull the thread so the just-sent message appears in the
      // conversation, then drop into the follow-up composer (an empty box) so
      // the operator can send another message if needed.
      void onReplySent();
      setSent(true);
    } catch (e) {
      if (e instanceof SendBlockedError) {
        setNeedsReconnect(true);
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "Send failed.");
      }
    } finally {
      setSending(false);
    }
  };

  const footerStyle: React.CSSProperties = {
    flex: "none",
    borderTop: "1px solid var(--border)",
    background: "var(--surface-3)",
    padding: isMobile ? "14px 16px 16px" : "16px 26px 18px",
  };

  // Once a reply has been sent, the sent message lives in the conversation
  // thread above. The composer becomes a fresh, empty follow-up box so the
  // operator can send another message if needed (it does not keep showing the
  // text that was just sent).
  if (isSent || sent) {
    return (
      <FollowUpComposer
        threadId={threadId}
        canSend={canSend}
        isMobile={isMobile}
        onBack={onSent}
        onReplySent={onReplySent}
      />
    );
  }

  return (
    <div style={footerStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
        <span style={{ width: 20, height: 20, borderRadius: 5, background: "var(--accent)", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>✦</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{draft ? "AI draft" : "Reply"}</span>
        {draft && <span style={{ fontSize: 12, color: "var(--text-3)" }}>· {draft.confidence ?? "—"} confidence</span>}
        {isMobile && draft && <ConfidenceDots confidence={draft.confidence} />}
      </div>

      {loading && !draft ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 10, padding: "18px", textAlign: "center", fontSize: 13.5, color: "var(--text-3)" }}>
          Loading…
        </div>
      ) : (
        <>
          {!draft && (
            <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 9, lineHeight: 1.45 }}>
              Write a reply below, or generate one grounded in the knowledge base, brand tone, and this customer's Shopify orders.
            </div>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={isMobile ? 7 : 9}
            placeholder={draft ? undefined : "Write your reply…"}
            style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14, fontFamily: "var(--sans)", lineHeight: 1.55, resize: "vertical" }}
          />
        </>
      )}

      {draft?.recommendedAction && (
        <div style={{ marginTop: 10, padding: "10px 13px", borderRadius: 9, fontSize: 12.5, background: "var(--warn-bg)", color: "var(--warn-tx)", border: "1px solid var(--warn-bd)" }}>
          <b>Suggested action (do manually):</b> {draft.recommendedAction}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--warn-tx)" }}>
          {error}
          {needsReconnect && (
            <>
              {" "}
              <a href={api.gmailConnectUrl()} style={{ color: "var(--accent)", fontWeight: 600 }}>Reconnect Gmail →</a>
            </>
          )}
        </div>
      )}

      {/* primary action — full width on mobile */}
      <div style={{ marginTop: 14 }}>
        <button
          onClick={() => void send()}
          disabled={sending || !canSend || !body.trim()}
          title={canSend ? undefined : "Reconnect Gmail to enable sending"}
          style={{ width: isMobile ? "100%" : "auto", border: "none", cursor: sending || !canSend || !body.trim() ? "default" : "pointer", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 14.5, fontWeight: 600, padding: "12px 22px", borderRadius: 9, opacity: sending || !canSend || !body.trim() ? 0.5 : 1 }}
        >
          {sending ? "Sending…" : draft ? "Approve & Send" : "Send reply"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 12, flexWrap: "wrap" }}>
        <button onClick={() => void generate()} disabled={generating} style={{ border: "1px solid var(--border)", cursor: generating ? "default" : "pointer", background: "var(--surface)", color: "var(--text-2)", fontSize: 14, fontWeight: 500, padding: "10px 15px", borderRadius: 9 }}>
          {generating ? "…" : draft ? "Regenerate" : "✦ Generate draft"}
        </button>
        {draft && (
          <button onClick={() => void dismiss()} style={{ border: "1px solid var(--border)", cursor: "pointer", background: "transparent", color: "var(--text-3)", fontSize: 14, fontWeight: 500, padding: "10px 13px", borderRadius: 9 }}>
            Discard draft
          </button>
        )}
        {isCustomer === false ? (
          <button onClick={() => onReclassify(true)} disabled={reclassifying} style={{ marginLeft: isMobile ? 0 : "auto", cursor: reclassifying ? "default" : "pointer", border: "1px solid var(--border)", background: "var(--accent-soft-bg)", color: "var(--accent-soft-fg)", fontSize: 14, fontWeight: 600, padding: "10px 15px", borderRadius: 9 }}>
            ✓ Mark as customer request
          </button>
        ) : (
          <button onClick={() => onReclassify(false)} disabled={reclassifying} title="Move this thread to Filtered out" style={{ marginLeft: isMobile ? 0 : "auto", cursor: reclassifying ? "default" : "pointer", border: "none", background: "transparent", color: "var(--text-3)", fontSize: 14, fontWeight: 500, padding: "10px 12px", borderRadius: 8 }}>
            Dismiss · mark as noise
          </button>
        )}
      </div>
    </div>
  );
}

// Shown once a thread has been replied to: an empty composer for sending a
// manual follow-up. Each send goes through the same guarded server send path
// (it creates an operator-authored draft and sends it) — never auto-send.
function FollowUpComposer({
  threadId,
  canSend,
  isMobile,
  onBack,
  onReplySent,
}: {
  threadId: string;
  canSend: boolean;
  isMobile: boolean;
  onBack: () => void;
  onReplySent: () => void | Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [justSent, setJustSent] = useState(false);

  const send = async () => {
    if (sending || !body.trim()) return;
    setSending(true);
    setError(null);
    setNeedsReconnect(false);
    try {
      await api.sendManualReply(threadId, body);
      setBody("");
      setJustSent(true);
      // Refresh the conversation so the follow-up appears in the thread.
      void onReplySent();
    } catch (e) {
      if (e instanceof SendBlockedError) {
        setNeedsReconnect(true);
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "Send failed.");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        flex: "none",
        borderTop: "1px solid var(--border)",
        background: "var(--surface-3)",
        padding: isMobile ? "14px 16px 16px" : "16px 26px 18px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-soft-fg)" }}>✓ Replied</span>
        <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>
          {justSent ? "Follow-up sent." : "Send a follow-up below if needed."}
        </span>
        <button
          onClick={onBack}
          style={{ marginLeft: "auto", cursor: "pointer", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-2)", fontSize: 13, fontWeight: 600, padding: "7px 13px", borderRadius: 8 }}
        >
          Back to inbox
        </button>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={isMobile ? 5 : 6}
        placeholder="Write a follow-up reply…"
        style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14, fontFamily: "var(--sans)", lineHeight: 1.55, resize: "vertical" }}
      />

      {error && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--warn-tx)" }}>
          {error}
          {needsReconnect && (
            <>
              {" "}
              <a href={api.gmailConnectUrl()} style={{ color: "var(--accent)", fontWeight: 600 }}>Reconnect Gmail →</a>
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <button
          onClick={() => void send()}
          disabled={sending || !canSend || !body.trim()}
          title={canSend ? undefined : "Reconnect Gmail to enable sending"}
          style={{ width: isMobile ? "100%" : "auto", border: "none", cursor: sending || !canSend || !body.trim() ? "default" : "pointer", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 14.5, fontWeight: 600, padding: "12px 22px", borderRadius: 9, opacity: sending || !canSend || !body.trim() ? 0.5 : 1 }}
        >
          {sending ? "Sending…" : "Send follow-up"}
        </button>
      </div>
    </div>
  );
}

// Cache resolved Shopify context per thread for this session so reopening a
// thread doesn't re-mint a token + re-query Shopify on every open.
const shopifyCache = new Map<string, ShopifyContextDTO>();

function statusColor(status: string | null): { bg: string; fg: string } {
  const s = (status ?? "").toUpperCase();
  if (["PAID", "FULFILLED"].includes(s)) return { bg: "var(--accent-soft-bg)", fg: "var(--accent-soft-fg)" };
  if (["REFUNDED", "UNFULFILLED", "PARTIALLY_REFUNDED", "VOIDED"].includes(s)) return { bg: "var(--cat-exchange-bg)", fg: "var(--cat-exchange-fg)" };
  return { bg: "var(--surface-2)", fg: "var(--text-3)" };
}

function OrderCard({ order }: { order: ShopifyOrderDTO }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 11, padding: "12px 13px", marginBottom: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span style={{ fontWeight: 700, fontSize: 13.5, fontFamily: "var(--mono)" }}>{order.name}</span>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{formatTime(order.createdAt)}</span>
        <span style={{ marginLeft: "auto", fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
          {order.total ? `${order.total} ${order.currency ?? ""}` : ""}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {[order.financialStatus, order.fulfillmentStatus].filter((s): s is string => Boolean(s)).map((s) => {
          const c = statusColor(s);
          return (
            <span key={s} style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.02em", padding: "2px 8px", borderRadius: 999, background: c.bg, color: c.fg }}>
              {s.replace(/_/g, " ")}
            </span>
          );
        })}
      </div>
      {order.lineItems.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
          {order.lineItems.map((li, i) => (
            <div key={i} style={{ display: "flex", gap: 6 }}>
              <span style={{ color: "var(--text-3)" }}>{li.quantity}×</span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{li.title}</span>
            </div>
          ))}
        </div>
      )}
      {order.tracking.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {order.tracking.map((t, i) => (
            <div key={i} style={{ fontSize: 12, fontFamily: "var(--mono)", overflowWrap: "anywhere" }}>
              {t.company ? `${t.company}: ` : ""}
              {t.url ? (
                <a href={t.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{t.number ?? "track"}</a>
              ) : (
                <span style={{ color: "var(--text-2)" }}>{t.number}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ShopifyContextPanel({ threadId, email }: { threadId: string; email: string | null }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [ctx, setCtx] = useState<ShopifyContextDTO | null>(() => shopifyCache.get(threadId) ?? null);
  const [loading, setLoading] = useState(false);
  const [orderQuery, setOrderQuery] = useState("");

  const resolve = (force = false) => {
    if (!force && shopifyCache.has(threadId)) {
      setCtx(shopifyCache.get(threadId)!);
      return;
    }
    setLoading(true);
    api.threadShopify(threadId)
      .then((c) => {
        shopifyCache.set(threadId, c);
        setCtx(c);
      })
      .catch(() => setCtx({ found: false, customer: null, orders: [], matchedBy: null }))
      .finally(() => setLoading(false));
  };

  const findOrder = (order: string) => {
    setLoading(true);
    api.threadShopifyOrder(threadId, order)
      .then((c) => {
        shopifyCache.set(threadId, c);
        setCtx(c);
      })
      .catch(() => setCtx({ found: false, customer: null, orders: [], matchedBy: null }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let active = true;
    void api.shopifyStatus()
      .then((s) => {
        if (!active) return;
        setConfigured(s.configured);
        if (s.configured) resolve();
      })
      .catch(() => active && setConfigured(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  if (configured === false) {
    return (
      <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "18px 16px", textAlign: "center" }}>
        <div style={{ margin: "0 auto 8px", color: "var(--text-3)" }}><BagIcon size={18} strokeWidth={1.8} /></div>
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>Shopify isn't connected. Add the store credentials to see order context.</div>
      </div>
    );
  }

  const matchLabel =
    ctx?.matchedBy === "order" ? "matched by order number"
      : ctx?.matchedBy === "email" ? "matched by email"
      : ctx?.matchedBy === "pinned" ? "pinned order" : null;
  const inputStyle: React.CSSProperties = { flex: 1, minWidth: 0, height: 40, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, fontFamily: "var(--mono)" };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <input
          value={orderQuery}
          onChange={(e) => setOrderQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && orderQuery.trim()) findOrder(orderQuery.trim()); }}
          placeholder="Find by email, name, phone, or order #"
          style={{ ...inputStyle, fontFamily: "var(--sans)" }}
        />
        <button onClick={() => orderQuery.trim() && findOrder(orderQuery.trim())} style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "0 14px", height: 40, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-2)" }}>
          Find
        </button>
      </div>

      <button onClick={() => resolve(true)} title={email ?? undefined} style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "7px 11px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text-3)", marginBottom: 12, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        ↺ Auto-match by email
      </button>

      {loading && <div style={{ fontSize: 13, color: "var(--text-3)", padding: "8px 0" }}>Looking up Shopify…</div>}

      {!loading && ctx && !ctx.found && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 11, padding: "14px", fontSize: 13, color: "var(--text-3)" }}>
          No matching customer or order found. Try a specific order number above.
        </div>
      )}

      {!loading && ctx?.found && (
        <>
          {matchLabel && <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 8 }}>{matchLabel}</div>}
          {ctx.customer && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 11, padding: "13px 14px", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{ctx.customer.name ?? ctx.customer.email ?? "Customer"}</div>
              {ctx.customer.email && <div style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--mono)", marginBottom: 8, overflowWrap: "anywhere" }}>{ctx.customer.email}</div>}
              <div style={{ display: "flex", gap: 16, fontSize: 12.5 }}>
                <span style={{ color: "var(--text-3)" }}>Orders: <b style={{ color: "var(--text)" }}>{ctx.customer.ordersCount ?? "—"}</b></span>
                {ctx.customer.totalSpent && (
                  <span style={{ color: "var(--text-3)" }}>Spent: <b style={{ color: "var(--text)" }}>{ctx.customer.totalSpent} {ctx.customer.currency ?? ""}</b></span>
                )}
              </div>
            </div>
          )}
          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 8 }}>
            {ctx.orders.length === 1 ? "Order" : "Recent orders"}
          </div>
          {ctx.orders.map((o) => <OrderCard key={o.name} order={o} />)}
        </>
      )}
    </div>
  );
}
