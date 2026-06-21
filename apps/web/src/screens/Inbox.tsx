import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ThreadSummaryDTO } from "@ms/shared";
import { api } from "../api";
import { useSync } from "../sync";
import { CheckCircleIcon, ChevronDownIcon, FilterIcon } from "../icons";
import {
  avatarTokens,
  categoryTokens,
  confColor,
  confLabel,
  initialsFrom,
  shortTime,
  statusLabel,
  statusPulses,
  statusTokens,
} from "../tokens";

type StatusFilter = "needs" | "all" | "sent";
type Tab = "customer" | "noise";

const STATUS_QUERY: Record<StatusFilter, string | undefined> = {
  needs: "needs_review",
  all: undefined,
  sent: "sent",
};

export function Inbox() {
  const navigate = useNavigate();
  const { syncing, completedAt } = useSync();
  const [tab, setTab] = useState<Tab>("customer");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("needs");
  const [threads, setThreads] = useState<ThreadSummaryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await api.listThreads({
          status: STATUS_QUERY[statusFilter],
        });
        if (!active) return;
        setThreads(res.items);
        setTotal(res.total);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [statusFilter, completedAt]);

  const needsReviewCount = useMemo(
    () => threads.filter((t) => t.status === "needs_review").length,
    [threads],
  );
  const subtitle = `${needsReviewCount} need review · ${total} customer threads`;

  const showCaughtUp =
    !loading && statusFilter === "needs" && threads.length === 0 && tab === "customer";

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
      {/* toolbar */}
      <div style={{ flex: "none", padding: "20px 28px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div>
            <h1
              style={{
                margin: "0 0 3px",
                fontSize: 21,
                fontWeight: 700,
                letterSpacing: "-0.015em",
                color: "var(--text)",
              }}
            >
              Inbox
            </h1>
            <div style={{ fontSize: 13.5, color: "var(--text-3)" }}>
              {subtitle}
            </div>
          </div>
          {syncing && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--accent-soft-fg)",
                background: "var(--accent-soft-bg)",
                padding: "6px 12px",
                borderRadius: 999,
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  border: "2px solid currentColor",
                  borderRightColor: "transparent",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spin .7s linear infinite",
                }}
              />
              Syncing Gmail &amp; Shopify…
            </div>
          )}
        </div>

        {/* segmented control */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              display: "inline-flex",
              padding: 3,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 10,
            }}
          >
            <Segment
              active={tab === "customer"}
              onClick={() => setTab("customer")}
              label="Customer requests"
              count={total}
            />
            <Segment
              active={tab === "noise"}
              onClick={() => setTab("noise")}
              label="Filtered out"
              count={0}
            />
          </div>

          {tab === "customer" && (
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Chip
                label="Needs Review"
                primary
                selected={statusFilter === "needs"}
                onClick={() => setStatusFilter("needs")}
              />
              <Chip
                label="All"
                selected={statusFilter === "all"}
                onClick={() => setStatusFilter("all")}
              />
              <Chip
                label="Sent"
                selected={statusFilter === "sent"}
                onClick={() => setStatusFilter("sent")}
              />
              <div
                style={{
                  width: 1,
                  height: 20,
                  background: "var(--border)",
                  margin: "0 3px",
                }}
              />
              <button
                style={{
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text-2)",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                All categories
                <ChevronDownIcon size={12} strokeWidth={2.4} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* list */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "16px 28px 28px",
        }}
      >
        {tab === "noise" ? (
          <NoisePlaceholder />
        ) : showCaughtUp ? (
          <CaughtUp />
        ) : threads.length > 0 ? (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 13,
              overflow: "hidden",
              boxShadow: "var(--shadow)",
            }}
          >
            {threads.map((row) => (
              <ThreadRow
                key={row.id}
                row={row}
                onOpen={() => navigate(`/review/${row.id}`)}
              />
            ))}
          </div>
        ) : (
          <div
            style={{
              padding: "60px 20px",
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 14,
            }}
          >
            {loading ? "Loading…" : "No threads here yet. Run a sync to pull in your Gmail inbox."}
          </div>
        )}
      </div>
    </div>
  );
}

function Segment({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        cursor: "pointer",
        border: "none",
        fontSize: 13.5,
        fontWeight: 600,
        padding: "7px 14px",
        borderRadius: 7,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: active ? "var(--surface)" : "transparent",
        color: active ? "var(--text)" : "var(--text-3)",
        boxShadow: active ? "var(--shadow)" : "none",
      }}
    >
      {label}
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          fontWeight: 600,
          padding: "1px 7px",
          borderRadius: 999,
          background: active ? "var(--accent-soft-bg)" : "var(--surface)",
          color: active ? "var(--accent-soft-fg)" : "var(--text-3)",
        }}
      >
        {count}
      </span>
    </button>
  );
}

function Chip({
  label,
  selected,
  primary,
  onClick,
}: {
  label: string;
  selected: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  const bg = selected
    ? primary
      ? "var(--accent)"
      : "var(--text)"
    : "var(--surface)";
  const fg = selected ? "#fff" : "var(--text-2)";
  return (
    <button
      onClick={onClick}
      style={{
        cursor: "pointer",
        fontSize: 13,
        fontWeight: selected ? 600 : 500,
        padding: "6px 12px",
        borderRadius: 8,
        border: `1px solid ${selected ? "transparent" : "var(--border)"}`,
        background: bg,
        color: fg,
      }}
    >
      {label}
    </button>
  );
}

function ThreadRow({
  row,
  onOpen,
}: {
  row: ThreadSummaryDTO;
  onOpen: () => void;
}) {
  const cat = categoryTokens(row.category?.slug);
  const av = avatarTokens(row.customerEmail ?? row.id);
  const st = statusTokens(row.status);
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 15,
        padding: "15px 18px",
        borderBottom: "1px solid var(--border-2)",
        background: hover ? "var(--hover)" : "transparent",
      }}
    >
      <div style={{ flex: "none", width: 9, display: "flex", justifyContent: "center" }}>
        {row.unread && (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--accent)",
            }}
          />
        )}
      </div>
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
        {initialsFrom(row.customerName, row.customerEmail)}
      </div>
      <div style={{ flex: "none", width: 178, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14.5,
            fontWeight: row.unread ? 700 : 600,
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.customerName ?? row.customerEmail ?? "Unknown"}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-3)",
            fontFamily: "var(--mono)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.customerEmail ?? ""}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: row.unread ? 700 : 600,
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.subject ?? "(no subject)"}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text-3)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.snippet ?? ""}
        </div>
      </div>
      <span
        style={{
          flex: "none",
          width: 104,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.02em",
          padding: "3px 9px",
          borderRadius: 999,
          background: cat.bg,
          color: cat.fg,
          whiteSpace: "nowrap",
          textAlign: "center",
          visibility: row.category ? "visible" : "hidden",
        }}
      >
        {row.category?.name ?? "—"}
      </span>
      <div style={{ flex: "none", width: 118, display: "flex" }}>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: 999,
            background: st.bg,
            color: st.fg,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          {statusPulses(row.status) && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "currentColor",
                animation: "pulse 1.3s ease-in-out infinite",
              }}
            />
          )}
          {statusLabel(row.status)}
        </span>
      </div>
      <div style={{ flex: "none", width: 84, display: "flex" }}>
        {row.confidence && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            title="Draft confidence"
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: confColor(row.confidence),
              }}
            />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: confColor(row.confidence),
              }}
            >
              {confLabel(row.confidence)}
            </span>
          </span>
        )}
      </div>
      <div
        style={{
          flex: "none",
          width: 62,
          textAlign: "right",
          fontSize: 12,
          color: "var(--text-3)",
        }}
      >
        {shortTime(row.lastMessageAt)}
      </div>
    </div>
  );
}

function CaughtUp() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "90px 20px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 62,
          height: 62,
          borderRadius: "50%",
          background: "var(--accent-soft-bg)",
          color: "var(--accent-soft-fg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 18,
        }}
      >
        <CheckCircleIcon size={28} strokeWidth={2.2} />
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--text)",
          marginBottom: 6,
        }}
      >
        You're all caught up
      </div>
      <div
        style={{
          fontSize: 14,
          color: "var(--text-3)",
          maxWidth: 340,
          lineHeight: 1.5,
        }}
      >
        No threads need your review right now. New customer requests will surface
        here as they arrive.
      </div>
    </div>
  );
}

function NoisePlaceholder() {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          fontSize: 13,
          color: "var(--text-3)",
          marginBottom: 13,
          padding: "0 2px",
        }}
      >
        <FilterIcon size={15} />
        Automatically filtered by your sender rules — arrives in Phase 1 (triage
        gate). For now, all ingested threads appear under Customer requests.
      </div>
    </div>
  );
}
