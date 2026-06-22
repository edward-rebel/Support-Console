import { useEffect, useState } from "react";
import type { FeedbackDTO, FeedbackStatus, FeedbackType } from "@ms/shared";
import { api } from "../api";
import { useIsMobile } from "../useIsMobile";

const TYPE_TOKENS: Record<FeedbackType, { bg: string; fg: string; label: string }> = {
  bug: { bg: "var(--cat-exchange-bg)", fg: "var(--cat-exchange-fg)", label: "Bug" },
  feature: { bg: "var(--accent-soft-bg)", fg: "var(--accent-soft-fg)", label: "Feature" },
  enhancement: { bg: "var(--cat-shipping-bg)", fg: "var(--cat-shipping-fg)", label: "Enhancement" },
  question: { bg: "var(--cat-sizing-bg)", fg: "var(--cat-sizing-fg)", label: "Question" },
  other: { bg: "var(--cat-other-bg)", fg: "var(--cat-other-fg)", label: "Other" },
};

const FILTERS: { key: string; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "addressed", label: "Addressed" },
  { key: "dismissed", label: "Dismissed" },
  { key: "all", label: "All" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function Feedback() {
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState("open");
  const [rows, setRows] = useState<FeedbackDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    void api
      .listFeedback(filter === "all" ? undefined : filter)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, [filter]);

  const setStatus = async (id: string, status: FeedbackStatus) => {
    setRows((prev) =>
      filter === "all"
        ? prev.map((r) => (r.id === id ? { ...r, status } : r))
        : prev.filter((r) => r.id !== id),
    );
    try {
      await api.updateFeedback(id, status);
    } finally {
      load();
    }
  };
  const remove = async (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await api.deleteFeedback(id);
    } catch {
      load();
    }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: isMobile ? "16px 14px 40px" : "24px 32px 40px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: "0 0 3px", fontSize: 21, fontWeight: 700, letterSpacing: "-0.015em" }}>
            Feedback
          </h1>
          <div style={{ fontSize: 13.5, color: "var(--text-3)" }}>
            Bugs and requests submitted from the app — triaged and tracked here.
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: "7px 13px",
                borderRadius: 8,
                border: `1px solid ${filter === f.key ? "transparent" : "var(--border)"}`,
                background: filter === f.key ? "var(--text)" : "var(--surface)",
                color: filter === f.key ? "#fff" : "var(--text-2)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: "50px 0", textAlign: "center", color: "var(--text-3)" }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: "70px 20px", textAlign: "center", color: "var(--text-3)", fontSize: 14 }}>
            {filter === "open" ? "No open feedback. 🎉" : "Nothing here."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((f) => {
              const tok = f.type ? TYPE_TOKENS[f.type] : null;
              return (
                <div key={f.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", boxShadow: "var(--shadow)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    {tok && (
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: tok.bg, color: tok.fg }}>
                        {tok.label}
                      </span>
                    )}
                    {f.title && <span style={{ fontSize: 14, fontWeight: 600 }}>{f.title}</span>}
                    {f.status !== "open" && (
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: "var(--st-sent-bg)", color: "var(--st-sent-fg)" }}>
                        {f.status === "addressed" ? "Addressed" : "Dismissed"}
                      </span>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-3)" }}>{formatDate(f.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{f.message}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
                    {f.page && (
                      <span style={{ fontSize: 11.5, color: "var(--text-3)", fontFamily: "var(--mono)", background: "var(--surface-2)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 7 }}>
                        {f.page}
                      </span>
                    )}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      {f.status !== "addressed" && (
                        <button onClick={() => void setStatus(f.id, "addressed")} style={btn("var(--accent-soft-bg)", "var(--accent-soft-fg)")}>
                          ✓ Mark addressed
                        </button>
                      )}
                      {f.status === "open" && (
                        <button onClick={() => void setStatus(f.id, "dismissed")} style={btn("transparent", "var(--text-3)")}>
                          Dismiss
                        </button>
                      )}
                      {f.status !== "open" && (
                        <button onClick={() => void setStatus(f.id, "open")} style={btn("transparent", "var(--text-3)")}>
                          Reopen
                        </button>
                      )}
                      <button onClick={() => void remove(f.id)} style={btn("transparent", "var(--text-3)")}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function btn(bg: string, fg: string): React.CSSProperties {
  return {
    cursor: "pointer",
    fontSize: 12.5,
    fontWeight: 600,
    padding: "6px 11px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: bg,
    color: fg,
  };
}
