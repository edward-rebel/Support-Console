import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { MessageDTO, ThreadDetailDTO } from "@ms/shared";
import { api } from "../api";
import { useIsMobile } from "../useIsMobile";
import { ChevronLeftIcon, BagIcon } from "../icons";
import {
  avatarTokens,
  categoryTokens,
  initialsFrom,
} from "../tokens";

function splitParagraphs(raw: string): string[] {
  return raw
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

// Safely turn an HTML email body into readable text. DOMParser does NOT execute
// scripts, and we only read textContent, so no markup is rendered.
function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style, script, head").forEach((el) => el.remove());
  // Give block elements line breaks so paragraphs survive.
  doc.querySelectorAll("p, br, div, tr, li, h1, h2, h3").forEach((el) => {
    el.append("\n");
  });
  return (doc.body.textContent ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Message body as paragraphs: prefer plain text, fall back to extracted HTML.
function paragraphs(msg: MessageDTO): string[] {
  const text = msg.bodyText?.trim();
  if (text) return splitParagraphs(text);
  if (msg.bodyHtml) {
    const extracted = htmlToText(msg.bodyHtml);
    if (extracted) return splitParagraphs(extracted);
  }
  return ["(This message has no readable text content.)"];
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

export function Review() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [thread, setThread] = useState<ThreadDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const av = avatarTokens(thread.customerEmail ?? thread.id);
  const customerMessages = thread.messages.filter(
    (m) => m.direction === "inbound",
  );
  const shown = customerMessages.length > 0 ? customerMessages : thread.messages;
  const latest = shown[shown.length - 1];
  const earlierCount = shown.length - 1;

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
            background: "var(--surface)",
          }}
        >
          <div
            style={{
              flex: isMobile ? "none" : 1,
              minHeight: 0,
              overflow: isMobile ? "visible" : "auto",
              padding: isMobile ? "18px 16px" : "24px 30px",
            }}
          >
            {earlierCount > 0 && (
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <span
                  style={{
                    fontSize: 12.5,
                    color: "var(--text-3)",
                    background: "var(--surface-2)",
                    padding: "4px 13px",
                    borderRadius: 999,
                  }}
                >
                  Earlier in conversation · {earlierCount}{" "}
                  {earlierCount === 1 ? "message" : "messages"}
                </span>
              </div>
            )}
            {latest && (
              <div style={{ display: "flex", gap: 14, marginBottom: 22 }}>
                <div
                  style={{
                    flex: "none",
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: av.bg,
                    color: av.fg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 600,
                    fontSize: 14,
                  }}
                >
                  {initialsFrom(thread.customerName, thread.customerEmail)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 9,
                      marginBottom: isMobile ? 1 : 4,
                      flexWrap: isMobile ? "wrap" : "nowrap",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 15,
                        color: "var(--text)",
                        flex: isMobile ? 1 : "none",
                        minWidth: 0,
                      }}
                    >
                      {thread.customerName ?? thread.customerEmail ?? "Customer"}
                    </span>
                    <span
                      style={{
                        marginLeft: isMobile ? 0 : "auto",
                        order: isMobile ? 1 : 0,
                        fontSize: 12.5,
                        color: "var(--text-3)",
                        whiteSpace: "nowrap",
                        flex: "none",
                      }}
                    >
                      {formatTime(latest.gmailInternalDate)}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-3)",
                        fontFamily: "var(--mono)",
                        order: isMobile ? 2 : 0,
                        flexBasis: isMobile ? "100%" : "auto",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                      }}
                    >
                      {thread.customerEmail ?? ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 15.5, lineHeight: 1.68, color: "var(--text)" }}>
                    {paragraphs(latest).map((p, i) => (
                      <p key={i} style={{ margin: "0 0 12px" }}>
                        {p}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* composer — Phase 0 placeholder (AI drafting arrives in Phase 3) */}
          <div
            style={{
              flex: "none",
              borderTop: "1px solid var(--border)",
              background: "var(--surface-3)",
              padding: isMobile ? "14px 16px 16px" : "16px 30px 18px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginBottom: 11,
              }}
            >
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
              the knowledge base — and you'll approve, edit, or regenerate it.
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                paddingTop: 15,
              }}
            >
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
          <div
            style={{
              background: "var(--surface)",
              border: "1px dashed var(--border)",
              borderRadius: 12,
              padding: "20px 16px",
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                background: "var(--surface-2)",
                color: "var(--text-3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 10px",
              }}
            >
              <BagIcon size={19} strokeWidth={1.8} />
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-2)",
                marginBottom: 4,
              }}
            >
              Shopify context arrives in Phase 4
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5 }}>
              Matching order, line items, and tracking will appear here once the
              read-only Shopify integration is wired up.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
