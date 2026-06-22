import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ThreadSummaryDTO } from "@ms/shared";
import { api } from "../api";
import { avatarTokens, initialsFrom, shortTime } from "../tokens";

// ⌘K thread search: debounced query over subject + customer name/email.
export function SearchOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ThreadSummaryDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setRows([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setRows([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const h = setTimeout(() => {
      void api
        .listThreads({ q: term, page: 1 })
        .then((r) => active && setRows(r.items.slice(0, 12)))
        .catch(() => active && setRows([]))
        .finally(() => active && setLoading(false));
    }, 220);
    return () => {
      active = false;
      clearTimeout(h);
    };
  }, [q, open]);

  if (!open) return null;

  const go = (id: string) => {
    onClose();
    navigate(`/review/${id}`);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(20,18,14,.4)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "12vh 16px 16px",
        animation: "fadein .12s",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(20,18,14,.3)",
          overflow: "hidden",
          animation: "popin .14s",
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search threads by subject, customer name, or email…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            border: "none",
            borderBottom: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text)",
            fontSize: 15,
            padding: "16px 18px",
            outline: "none",
            fontFamily: "var(--sans)",
          }}
        />
        <div style={{ maxHeight: "50vh", overflow: "auto" }}>
          {q.trim().length < 2 ? (
            <div style={{ padding: "22px 18px", fontSize: 13, color: "var(--text-3)" }}>
              Type at least 2 characters to search.
            </div>
          ) : loading && rows.length === 0 ? (
            <div style={{ padding: "22px 18px", fontSize: 13, color: "var(--text-3)" }}>Searching…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "22px 18px", fontSize: 13, color: "var(--text-3)" }}>No matches.</div>
          ) : (
            rows.map((r) => {
              const av = avatarTokens(r.customerEmail ?? r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => go(r.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                    border: "none",
                    background: "transparent",
                    display: "flex",
                    gap: 11,
                    alignItems: "center",
                    padding: "11px 16px",
                    borderBottom: "1px solid var(--border-2)",
                  }}
                >
                  <span style={{ flex: "none", width: 32, height: 32, borderRadius: "50%", background: av.bg, color: av.fg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 12 }}>
                    {initialsFrom(r.customerName, r.customerEmail)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.subject ?? "(no subject)"}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.customerName ?? r.customerEmail ?? "Unknown"}
                    </span>
                  </span>
                  <span style={{ flex: "none", fontSize: 11.5, color: "var(--text-3)" }}>{shortTime(r.lastMessageAt)}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
