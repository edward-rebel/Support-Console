import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DOMPurify from "dompurify";
import type {
  MessageDTO,
  ShopifyContextDTO,
  ShopifyOrderDTO,
  ThreadDetailDTO,
} from "@ms/shared";
import { api } from "../api";
import { useIsMobile } from "../useIsMobile";
import { ChevronLeftIcon, BagIcon } from "../icons";
import { avatarTokens, categoryTokens, initialsFrom } from "../tokens";

// Open any links in sanitized email bodies safely in a new tab.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// Sanitize email HTML for rendering: DOMPurify removes scripts/handlers; we also
// drop inline styles/classes and layout attributes so messages render in our own
// typography instead of forcing their own widths/colors.
function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "script", "iframe", "link", "meta", "head", "title", "form", "input", "button", "object", "embed", "svg"],
    FORBID_ATTR: ["style", "class", "width", "height", "align", "bgcolor", "background", "srcset"],
    ALLOW_DATA_ATTR: false,
  });
}

// "Name <email>" → display parts.
function parseAddress(raw: string | null): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: (m[1] ?? "").trim() || null, email: (m[2] ?? "").trim() || null };
  if (raw.includes("@")) return { name: null, email: raw.trim() };
  return { name: raw.trim() || null, email: null };
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function hasBody(msg: MessageDTO): boolean {
  return Boolean(msg.bodyText?.trim() || msg.bodyHtml?.trim());
}

function MessageBody({ msg }: { msg: MessageDTO }) {
  // Prefer plain text (preserve line breaks); fall back to sanitized HTML.
  const text = msg.bodyText?.trim();
  if (text) {
    return <div className="email-text">{text}</div>;
  }
  if (msg.bodyHtml?.trim()) {
    return (
      <div
        className="email-html"
        dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(msg.bodyHtml) }}
      />
    );
  }
  return (
    <div style={{ fontSize: 14, color: "var(--text-3)", fontStyle: "italic" }}>
      (This message has no readable text content.)
    </div>
  );
}

function MessageCard({
  msg,
  fallbackName,
}: {
  msg: MessageDTO;
  fallbackName: string | null;
}) {
  const outbound = msg.direction === "outbound";
  const addr = parseAddress(msg.fromAddress);
  const name = outbound
    ? addr.name ?? "Molly & Stitch"
    : addr.name ?? fallbackName ?? addr.email ?? "Customer";
  const av = avatarTokens(addr.email ?? name);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: outbound ? "var(--accent-soft-bg)" : "var(--surface)",
        padding: "13px 15px",
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            flex: "none",
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: outbound ? "var(--accent)" : av.bg,
            color: outbound ? "var(--accent-fg)" : av.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {outbound ? "MS" : initialsFrom(name, addr.email)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text)" }}>
              {name}
            </span>
            {outbound && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  textTransform: "uppercase",
                  color: "var(--accent-soft-fg)",
                }}
              >
                Sent
              </span>
            )}
            {addr.email && (
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--text-3)",
                  fontFamily: "var(--mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {addr.email}
              </span>
            )}
          </div>
        </div>
        <span style={{ flex: "none", fontSize: 12, color: "var(--text-3)" }}>
          {formatTime(msg.gmailInternalDate)}
        </span>
      </div>
      <MessageBody msg={msg} />
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

  useEffect(() => {
    if (!id) return;
    let active = true;
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

  // Jump to the newest message (bottom) once the thread loads, like an inbox.
  useEffect(() => {
    if (thread && scrollRef.current && !isMobile) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread, isMobile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate("/inbox");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  if (error) {
    return <div style={{ padding: 40, color: "var(--text-3)" }}>{error}</div>;
  }
  if (!thread) {
    return <div style={{ padding: 40, color: "var(--text-3)" }}>Loading…</div>;
  }

  const cat = categoryTokens(thread.category?.slug);
  // Show the full back-and-forth, oldest first / newest last (API returns asc).
  const conversation = thread.messages.filter(hasBody);
  const shown = conversation.length > 0 ? conversation : thread.messages;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* review header */}
      <div
        style={{
          flex: "none",
          height: 60,
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 10 : 13,
          padding: isMobile ? "0 14px" : "0 22px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <button
          onClick={() => navigate("/inbox")}
          style={{
            cursor: "pointer",
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ChevronLeftIcon size={16} strokeWidth={2.2} />
        </button>
        {thread.category && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.02em",
              padding: "3px 10px",
              borderRadius: 999,
              background: cat.bg,
              color: cat.fg,
            }}
          >
            {thread.category.name}
          </span>
        )}
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: isMobile ? 200 : 520,
            flex: isMobile ? 1 : undefined,
          }}
        >
          {thread.subject ?? "(no subject)"}
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 9,
            flex: "none",
          }}
        >
          {!isMobile && (
            <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>
              Draft confidence
            </span>
          )}
          {[0, 1, 2].map((i) => (
            <i
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--dot-off)",
                display: "inline-block",
              }}
            />
          ))}
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-3)" }}>
            —
          </span>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          overflow: isMobile ? "auto" : "hidden",
        }}
      >
        {/* left: thread + composer */}
        <div
          style={{
            flex: isMobile ? "none" : 1.62,
            minWidth: 0,
            width: isMobile ? "100%" : undefined,
            display: "flex",
            flexDirection: "column",
            borderRight: isMobile ? "none" : "1px solid var(--border)",
            background: "var(--surface-2)",
          }}
        >
          <div
            ref={scrollRef}
            style={{
              flex: isMobile ? "none" : 1,
              minHeight: 0,
              overflow: isMobile ? "visible" : "auto",
              padding: isMobile ? "16px 14px" : "22px 26px",
            }}
          >
            {shown.length > 1 && (
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-3)",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    padding: "3px 12px",
                    borderRadius: 999,
                  }}
                >
                  {shown.length} messages in this conversation
                </span>
              </div>
            )}
            {shown.map((m) => (
              <MessageCard key={m.id} msg={m} fallbackName={thread.customerName} />
            ))}
          </div>

          {/* composer — placeholder until AI drafting arrives in Phase 3 */}
          <div
            style={{
              flex: "none",
              borderTop: "1px solid var(--border)",
              background: "var(--surface-3)",
              padding: isMobile ? "14px 16px 16px" : "16px 26px 18px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 5,
                  background: "var(--accent)",
                  color: "var(--accent-fg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                ✦
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                AI draft
              </span>
              <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>
                · drafting arrives in Phase 3
              </span>
            </div>
            <div
              style={{
                background: "var(--surface)",
                border: "1px dashed var(--border)",
                borderRadius: 10,
                padding: "20px 18px",
                fontSize: 14,
                color: "var(--text-3)",
                textAlign: "center",
              }}
            >
              No draft yet. In Phase 3 the AI will draft a reply here, grounded in
              the knowledge base and this customer's Shopify orders — and you'll
              approve, edit, or regenerate it.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 15 }}>
              <button
                disabled
                title="Sending is introduced in Phase 3"
                style={{
                  border: "none",
                  cursor: "not-allowed",
                  background: "var(--accent)",
                  color: "var(--accent-fg)",
                  fontSize: 14.5,
                  fontWeight: 600,
                  padding: "11px 20px",
                  borderRadius: 9,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  opacity: 0.45,
                }}
              >
                Approve &amp; Send
              </button>
              <button
                disabled
                style={{
                  border: "1px solid var(--border)",
                  cursor: "not-allowed",
                  background: "var(--surface)",
                  color: "var(--text-3)",
                  fontSize: 14,
                  fontWeight: 500,
                  padding: "10px 15px",
                  borderRadius: 9,
                  opacity: 0.6,
                }}
              >
                Regenerate
              </button>
              {thread.isCustomer === false ? (
                <button
                  onClick={() => void reclassify(true)}
                  disabled={reclassifying}
                  style={{
                    marginLeft: "auto",
                    cursor: reclassifying ? "default" : "pointer",
                    border: "1px solid var(--border)",
                    background: "var(--accent-soft-bg)",
                    color: "var(--accent-soft-fg)",
                    fontSize: 14,
                    fontWeight: 600,
                    padding: "10px 15px",
                    borderRadius: 9,
                  }}
                >
                  ✓ Mark as customer request
                </button>
              ) : (
                <button
                  onClick={() => void reclassify(false)}
                  disabled={reclassifying}
                  title="Move this thread to Filtered out"
                  style={{
                    marginLeft: "auto",
                    cursor: reclassifying ? "default" : "pointer",
                    border: "none",
                    background: "transparent",
                    color: "var(--text-3)",
                    fontSize: 14,
                    fontWeight: 500,
                    padding: "10px 12px",
                    borderRadius: 8,
                  }}
                >
                  Dismiss · mark as noise
                </button>
              )}
            </div>
          </div>
        </div>

        {/* right: context rail */}
        <div
          style={{
            flex: "none",
            width: isMobile ? "100%" : 392,
            overflow: isMobile ? "visible" : "auto",
            padding: isMobile ? "18px 16px 24px" : "24px 22px",
            background: "var(--surface-2)",
            borderTop: isMobile ? "1px solid var(--border)" : "none",
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-3)",
              marginBottom: 13,
            }}
          >
            Context
          </div>
          {id && <ShopifyContextPanel threadId={id} email={thread.customerEmail} />}
        </div>
      </div>
    </div>
  );
}

// ── Shopify order/customer context (read-only) ───────────────────────────────
function statusColor(status: string | null): { bg: string; fg: string } {
  const s = (status ?? "").toUpperCase();
  if (["PAID", "FULFILLED"].includes(s))
    return { bg: "var(--accent-soft-bg)", fg: "var(--accent-soft-fg)" };
  if (["REFUNDED", "UNFULFILLED", "PARTIALLY_REFUNDED", "VOIDED"].includes(s))
    return { bg: "var(--cat-exchange-bg)", fg: "var(--cat-exchange-fg)" };
  return { bg: "var(--surface-2)", fg: "var(--text-3)" };
}

function OrderCard({ order }: { order: ShopifyOrderDTO }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 11,
        padding: "12px 13px",
        marginBottom: 9,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span style={{ fontWeight: 700, fontSize: 13.5, fontFamily: "var(--mono)" }}>
          {order.name}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          {formatTime(order.createdAt)}
        </span>
        <span style={{ marginLeft: "auto", fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
          {order.total ? `${order.total} ${order.currency ?? ""}` : ""}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {[order.financialStatus, order.fulfillmentStatus]
          .filter((s): s is string => Boolean(s))
          .map((s) => {
            const c = statusColor(s);
            return (
              <span
                key={s}
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: c.bg,
                  color: c.fg,
                }}
              >
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
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {li.title}
              </span>
            </div>
          ))}
        </div>
      )}
      {order.tracking.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {order.tracking.map((t, i) => (
            <div key={i} style={{ fontSize: 12, fontFamily: "var(--mono)" }}>
              {t.company ? `${t.company}: ` : ""}
              {t.url ? (
                <a href={t.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  {t.number ?? "track"}
                </a>
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
  const [ctx, setCtx] = useState<ShopifyContextDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [orderQuery, setOrderQuery] = useState("");

  const resolve = () => {
    setLoading(true);
    api
      .threadShopify(threadId)
      .then(setCtx)
      .catch(() => setCtx({ found: false, customer: null, orders: [], matchedBy: null }))
      .finally(() => setLoading(false));
  };

  const findOrder = (order: string) => {
    setLoading(true);
    api
      .threadShopifyOrder(threadId, order)
      .then(setCtx)
      .catch(() => setCtx({ found: false, customer: null, orders: [], matchedBy: null }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let active = true;
    void api
      .shopifyStatus()
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
      <div
        style={{
          background: "var(--surface)",
          border: "1px dashed var(--border)",
          borderRadius: 12,
          padding: "18px 16px",
          textAlign: "center",
        }}
      >
        <div style={{ margin: "0 auto 8px", color: "var(--text-3)" }}>
          <BagIcon size={18} strokeWidth={1.8} />
        </div>
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>
          Shopify isn't connected. Add the store credentials to see order context.
        </div>
      </div>
    );
  }

  const matchLabel =
    ctx?.matchedBy === "order"
      ? "matched by order number"
      : ctx?.matchedBy === "email"
        ? "matched by email"
        : ctx?.matchedBy === "pinned"
          ? "pinned order"
          : null;

  return (
    <div>
      {/* manual order lookup */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <input
          value={orderQuery}
          onChange={(e) => setOrderQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && orderQuery.trim()) findOrder(orderQuery.trim());
          }}
          placeholder="Look up order # (e.g. 21142)"
          style={{
            flex: 1,
            minWidth: 0,
            height: 32,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: 12.5,
            fontFamily: "var(--mono)",
          }}
        />
        <button
          onClick={() => orderQuery.trim() && findOrder(orderQuery.trim())}
          style={{
            cursor: "pointer",
            fontSize: 12.5,
            fontWeight: 600,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text-2)",
          }}
        >
          Find
        </button>
      </div>

      <button
        onClick={resolve}
        style={{
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          padding: "5px 10px",
          borderRadius: 7,
          border: "1px solid var(--border)",
          background: "transparent",
          color: "var(--text-3)",
          marginBottom: 12,
        }}
      >
        ↺ Auto-match{email ? ` (${email})` : ""}
      </button>

      {loading && (
        <div style={{ fontSize: 13, color: "var(--text-3)", padding: "8px 0" }}>
          Looking up Shopify…
        </div>
      )}

      {!loading && ctx && !ctx.found && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 11,
            padding: "14px 14px",
            fontSize: 13,
            color: "var(--text-3)",
          }}
        >
          No matching customer or order found. Try a specific order number above.
        </div>
      )}

      {!loading && ctx?.found && (
        <>
          {matchLabel && (
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 8 }}>
              {matchLabel}
            </div>
          )}
          {ctx.customer && (
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 11,
                padding: "13px 14px",
                marginBottom: 12,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
                {ctx.customer.name ?? ctx.customer.email ?? "Customer"}
              </div>
              {ctx.customer.email && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-3)",
                    fontFamily: "var(--mono)",
                    marginBottom: 8,
                  }}
                >
                  {ctx.customer.email}
                </div>
              )}
              <div style={{ display: "flex", gap: 16, fontSize: 12.5 }}>
                <span style={{ color: "var(--text-3)" }}>
                  Orders:{" "}
                  <b style={{ color: "var(--text)" }}>{ctx.customer.ordersCount ?? "—"}</b>
                </span>
                {ctx.customer.totalSpent && (
                  <span style={{ color: "var(--text-3)" }}>
                    Spent:{" "}
                    <b style={{ color: "var(--text)" }}>
                      {ctx.customer.totalSpent} {ctx.customer.currency ?? ""}
                    </b>
                  </span>
                )}
              </div>
            </div>
          )}
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-3)",
              marginBottom: 8,
            }}
          >
            {ctx.orders.length === 1 ? "Order" : "Recent orders"}
          </div>
          {ctx.orders.map((o) => (
            <OrderCard key={o.name} order={o} />
          ))}
        </>
      )}
    </div>
  );
}
