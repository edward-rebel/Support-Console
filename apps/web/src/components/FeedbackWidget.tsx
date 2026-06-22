import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";
import { MessageIcon } from "../icons";

// Persistent feedback launcher — a circular button pinned bottom-right on every
// screen that opens a small composer. Submissions are tagged with the current
// route and AI-triaged server-side.
export function FeedbackWidget() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      setSent(false);
      setTimeout(() => textRef.current?.focus(), 40);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const submit = async () => {
    const m = message.trim();
    if (!m || sending) return;
    setSending(true);
    try {
      await api.submitFeedback(m, location.pathname);
      setMessage("");
      setSent(true);
      setTimeout(() => setOpen(false), 1400);
    } catch {
      /* keep the text so the user can retry */
    } finally {
      setSending(false);
    }
  };

  return (
    <div ref={ref} style={{ position: "fixed", right: 20, bottom: 20, zIndex: 70 }}>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            bottom: 60,
            width: "min(340px, calc(100vw - 40px))",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            boxShadow: "0 16px 44px rgba(20,18,14,.26)",
            overflow: "hidden",
            animation: "popin .14s",
          }}
        >
          <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Send feedback</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
              A bug, an idea, anything — we'll triage it.
            </div>
          </div>
          {sent ? (
            <div style={{ padding: "26px 16px", textAlign: "center", fontSize: 14, color: "var(--accent-soft-fg)", fontWeight: 600 }}>
              ✓ Thanks — feedback logged.
            </div>
          ) : (
            <div style={{ padding: 14 }}>
              <textarea
                ref={textRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
                }}
                rows={4}
                placeholder="What's on your mind?"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  fontSize: 13.5,
                  fontFamily: "var(--sans)",
                  lineHeight: 1.5,
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 11, color: "var(--text-3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  on {location.pathname}
                </span>
                <button
                  onClick={() => void submit()}
                  disabled={sending || !message.trim()}
                  style={{
                    cursor: sending || !message.trim() ? "default" : "pointer",
                    border: "none",
                    background: "var(--accent)",
                    color: "var(--accent-fg)",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "9px 16px",
                    borderRadius: 9,
                    opacity: sending || !message.trim() ? 0.5 : 1,
                  }}
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Send feedback"
        title="Send feedback"
        style={{
          width: 50,
          height: 50,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          background: "var(--accent)",
          color: "var(--accent-fg)",
          boxShadow: "0 6px 18px rgba(20,18,14,.28)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MessageIcon size={22} />
      </button>
    </div>
  );
}
