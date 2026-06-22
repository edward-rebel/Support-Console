import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ThreadSummaryDTO } from "@ms/shared";
import { api } from "../api";
import { useSync } from "../sync";
import { useIsMobile } from "../useIsMobile";
import { CheckCircleIcon } from "../icons";
import {
  avatarTokens,
  categoryTokens,
  confColor,
  confLabel,
  initialsFrom,
  shortTime,
} from "../tokens";

// Focused approval queue: the customer threads that have an AI draft awaiting
// review, one tidy list that drops straight into the review/compose screen.
export function Approvals() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { completedAt } = useSync();
  const [rows, setRows] = useState<ThreadSummaryDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api
      .listThreads({ tab: "customer", status: "needs_review" })
      .then((r) => active && setRows(r.items))
      .catch(() => active && setRows([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [completedAt]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: isMobile ? "16px 14px 40px" : "24px 32px 40px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: "0 0 3px", fontSize: 21, fontWeight: 700, letterSpacing: "-0.015em" }}>
              Approvals
            </h1>
            <div style={{ fontSize: 13.5, color: "var(--text-3)" }}>
              {rows.length} draft{rows.length === 1 ? "" : "s"} awaiting your review
            </div>
          </div>
          {rows.length > 0 && (
            <button
              onClick={() => navigate(`/review/${rows[0]!.id}`)}
              style={{
                cursor: "pointer",
                border: "none",
                background: "var(--accent)",
                color: "var(--accent-fg)",
                fontSize: 13.5,
                fontWeight: 600,
                padding: "10px 18px",
                borderRadius: 9,
              }}
            >
              Review next →
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ padding: "60px 0", textAlign: "center", color: "var(--text-3)" }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 20px", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--accent-soft-bg)", color: "var(--accent-soft-fg)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <CheckCircleIcon size={26} strokeWidth={2.2} />
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 5 }}>Nothing to approve</div>
            <div style={{ fontSize: 14, color: "var(--text-3)", maxWidth: 360, lineHeight: 1.5 }}>
              When the AI drafts a reply for a customer thread, it shows up here for your review.
            </div>
          </div>
        ) : (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, overflow: "hidden", boxShadow: "var(--shadow)" }}>
            {rows.map((row) => {
              const av = avatarTokens(row.customerEmail ?? row.id);
              const cat = categoryTokens(row.category?.slug);
              return (
                <div
                  key={row.id}
                  onClick={() => navigate(`/review/${row.id}`)}
                  style={{ cursor: "pointer", display: "flex", gap: 13, alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border-2)" }}
                >
                  <div style={{ flex: "none", width: 38, height: 38, borderRadius: "50%", background: av.bg, color: av.fg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 13 }}>
                    {initialsFrom(row.customerName, row.customerEmail)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {row.customerName ?? row.customerEmail ?? "Unknown"}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {row.subject ?? "(no subject)"}
                    </div>
                  </div>
                  {row.category && (
                    <span style={{ flex: "none", fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, background: cat.bg, color: cat.fg, whiteSpace: "nowrap" }}>
                      {row.category.name}
                    </span>
                  )}
                  {row.confidence && !isMobile && (
                    <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: confColor(row.confidence) }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: confColor(row.confidence) }}>{confLabel(row.confidence)}</span>
                    </span>
                  )}
                  <span style={{ flex: "none", fontSize: 12, color: "var(--text-3)" }}>{shortTime(row.lastMessageAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
