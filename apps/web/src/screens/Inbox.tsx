import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CATEGORIES, type ThreadSummaryDTO } from "@ms/shared";
import { api } from "../api";
import { useSync } from "../sync";
import { useIsMobile } from "../useIsMobile";
import { CheckCircleIcon, ChevronDownIcon, FilterIcon } from "../icons";
import {
  avatarTokens,
  categoryTokens,
  confColor,
  confLabel,
  initialsFrom,
  sentimentLabel,
  sentimentTokens,
  shortTime,
  statusLabel,
  statusPulses,
  statusTokens,
} from "../tokens";

// Small reusable sentiment pill — only shown for notable (non-neutral) sentiment.
function SentimentPill({ sentiment }: { sentiment: ThreadSummaryDTO["sentiment"] }) {
  if (!sentiment || sentiment === "neutral") return null;
  const tok = sentimentTokens(sentiment);
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: tok.bg, color: tok.fg, whiteSpace: "nowrap" }}>
      {sentimentLabel(sentiment)}
    </span>
  );
}

type StatusFilter = "open" | "all" | "sent";
type Tab = "customer" | "noise";

const STATUS_QUERY: Record<StatusFilter, string | undefined> = {
  open: "open",
  all: undefined,
  sent: "sent",
};

// Open is the default landing filter on every fresh page load. Within a single
// page load we still restore the last-used filter when navigating thread → back
// (so browsing Sent and opening a thread returns you to Sent). Resets on reload.
let statusFilterInitialized = false;

export function Inbox() {
  const navigate = useNavigate();
  const { syncing, completedAt } = useSync();
  const isMobile = useIsMobile();
  // Persist the active tab / status / category to sessionStorage so opening a
  // thread and coming back (via the Back button, Esc, or browser back) restores
  // exactly where the operator was — e.g. "Filtered out" or "Needs Review" stays
  // selected rather than snapping back to Customer requests · All.
  const [tab, setTab] = useState<Tab>(() => {
    const v = sessionStorage.getItem("inbox.tab");
    return v === "noise" || v === "customer" ? v : "customer";
  });
  // Default to "Open" (unanswered customer requests) on a fresh page load.
  // After that, restore the last-used filter for thread → back navigation.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    if (!statusFilterInitialized) {
      statusFilterInitialized = true;
      return "open";
    }
    const v = sessionStorage.getItem("inbox.status");
    if (v === "needs") return "open";
    return v === "open" || v === "all" || v === "sent" ? v : "open";
  });
  const [category, setCategory] = useState<string | null>(() => {
    const v = sessionStorage.getItem("inbox.category");
    return v && CATEGORIES.some((c) => c.slug === v) ? v : null;
  });
  // Display-only sort of the rendered list by most-recent-message time. Always
  // defaults to newest-first (not persisted).
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    sessionStorage.setItem("inbox.tab", tab);
  }, [tab]);
  useEffect(() => {
    sessionStorage.setItem("inbox.status", statusFilter);
  }, [statusFilter]);
  useEffect(() => {
    if (category) sessionStorage.setItem("inbox.category", category);
    else sessionStorage.removeItem("inbox.category");
  }, [category]);
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const catRef = useRef<HTMLDivElement | null>(null);
  const [threads, setThreads] = useState<ThreadSummaryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [counts, setCounts] = useState({
    customer: 0,
    noise: 0,
    pending: 0,
    open: 0,
    needsReview: 0,
  });

  // Tab/subtitle badge counts.
  useEffect(() => {
    let active = true;
    void api
      .threadCounts()
      .then((c) => active && setCounts(c))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [completedAt, reload]);

  // First page for the active tab/filters (replaces the list).
  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await api.listThreads({
          tab,
          status: tab === "customer" ? STATUS_QUERY[statusFilter] : undefined,
          category: tab === "customer" ? (category ?? undefined) : undefined,
          page: 1,
          sort,
        });
        if (!active) return;
        setThreads(res.items);
        setTotal(res.total);
        setPage(1);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tab, statusFilter, category, sort, completedAt, reload]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await api.listThreads({
        tab,
        status: tab === "customer" ? STATUS_QUERY[statusFilter] : undefined,
        category: tab === "customer" ? (category ?? undefined) : undefined,
        page: next,
        sort,
      });
      setThreads((prev) => [...prev, ...res.items]);
      setTotal(res.total);
      setPage(next);
    } finally {
      setLoadingMore(false);
    }
  };

  const hasMore = threads.length < total;

  // Close the category dropdown on outside-click / Escape.
  useEffect(() => {
    if (!catMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (catRef.current && !catRef.current.contains(e.target as Node)) {
        setCatMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCatMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [catMenuOpen]);

  // Close the sort dropdown on outside-click / Escape.
  useEffect(() => {
    if (!sortMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSortMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [sortMenuOpen]);

  const reclassify = async (id: string, isCustomer: boolean) => {
    const prev = threads;
    setThreads((p) => p.filter((t) => t.id !== id)); // optimistic
    setActionError(null);
    try {
      await api.reclassifyThread(id, isCustomer);
      setReload((n) => n + 1);
    } catch {
      setThreads(prev); // restore on failure
      setActionError("Couldn't update that thread. Please try again.");
    }
  };

  const subtitle = `${counts.open} open · ${counts.customer} customer threads`;

  const showCaughtUp =
    !loading && statusFilter === "open" && threads.length === 0 && tab === "customer";

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
      <div style={{ flex: "none", padding: isMobile ? "16px 14px 0" : "20px 28px 0" }}>
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 8 : 14,
            flexWrap: "wrap",
            rowGap: 10,
          }}
        >
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
              label={isMobile ? "Customers" : "Customer requests"}
              count={counts.customer}
            />
            <Segment
              active={tab === "noise"}
              onClick={() => setTab("noise")}
              label={isMobile ? "Filtered" : "Filtered out"}
              count={counts.noise}
            />
          </div>

          {tab === "customer" && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", rowGap: 8 }}>
              <Chip
                label="Open"
                primary
                count={counts.open}
                selected={statusFilter === "open"}
                onClick={() => setStatusFilter("open")}
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
              <div style={{ position: "relative" }} ref={catRef}>
                <button
                  onClick={() => setCatMenuOpen((o) => !o)}
                  style={{
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 500,
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: category ? "var(--text)" : "var(--surface)",
                    color: category ? "#fff" : "var(--text-2)",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  {category
                    ? (CATEGORIES.find((c) => c.slug === category)?.name ??
                      "Category")
                    : "All categories"}
                  <ChevronDownIcon size={12} strokeWidth={2.4} />
                </button>
                {catMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      zIndex: 20,
                      minWidth: 170,
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      boxShadow: "0 12px 30px rgba(20,18,14,.18)",
                      padding: 5,
                    }}
                  >
                    <CatItem
                      label="All categories"
                      onClick={() => {
                        setCategory(null);
                        setCatMenuOpen(false);
                      }}
                      active={category === null}
                    />
                    {CATEGORIES.map((c) => (
                      <CatItem
                        key={c.slug}
                        label={c.name}
                        onClick={() => {
                          setCategory(c.slug);
                          setCatMenuOpen(false);
                        }}
                        active={category === c.slug}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sort control — display-only ordering of the rendered list. */}
          <div style={{ position: "relative", marginLeft: isMobile ? 0 : "auto" }} ref={sortRef}>
            <button
              onClick={() => setSortMenuOpen((o) => !o)}
              title="Sort by date"
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
              <span style={{ color: "var(--text-3)" }}>Sort:</span>
              {sort === "newest" ? "Newest first" : "Oldest first"}
              <ChevronDownIcon size={12} strokeWidth={2.4} />
            </button>
            {sortMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  right: 0,
                  zIndex: 20,
                  minWidth: 150,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  boxShadow: "0 12px 30px rgba(20,18,14,.18)",
                  padding: 5,
                }}
              >
                <CatItem
                  label="Newest first"
                  active={sort === "newest"}
                  onClick={() => {
                    setSort("newest");
                    setSortMenuOpen(false);
                  }}
                />
                <CatItem
                  label="Oldest first"
                  active={sort === "oldest"}
                  onClick={() => {
                    setSort("oldest");
                    setSortMenuOpen(false);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {actionError && (
        <div style={{ flex: "none", padding: isMobile ? "8px 14px 0" : "8px 28px 0" }}>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--warn-tx)",
              background: "var(--warn-bg)",
              border: "1px solid var(--warn-bd)",
              borderRadius: 9,
              padding: "8px 12px",
            }}
          >
            {actionError}
          </div>
        </div>
      )}

      {/* list */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: isMobile ? "12px 14px 24px" : "16px 28px 28px",
        }}
      >
        {tab === "noise" ? (
          <NoiseList
            rows={threads}
            loading={loading}
            isMobile={isMobile}
            onNotNoise={(id) => reclassify(id, true)}
            onOpen={(id) => navigate(`/review/${id}`)}
          />
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
                isMobile={isMobile}
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

        {hasMore && (
          <div style={{ display: "flex", justifyContent: "center", padding: "18px 0 4px" }}>
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              style={{
                cursor: loadingMore ? "default" : "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: "9px 18px",
                borderRadius: 9,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text-2)",
              }}
            >
              {loadingMore
                ? "Loading…"
                : `Load more (${threads.length} of ${total})`}
            </button>
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
  count,
  onClick,
}: {
  label: string;
  selected: boolean;
  primary?: boolean;
  count?: number;
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
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
      }}
    >
      {label}
      {count !== undefined && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            padding: "1px 7px",
            borderRadius: 999,
            background: selected ? "rgba(255,255,255,0.22)" : "var(--surface-2)",
            color: selected ? "#fff" : "var(--text-3)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ThreadRow({
  row,
  isMobile,
  onOpen,
}: {
  row: ThreadSummaryDTO;
  isMobile: boolean;
  onOpen: () => void;
}) {
  const cat = categoryTokens(row.category?.slug);
  const av = avatarTokens(row.customerEmail ?? row.id);
  const st = statusTokens(row.status);
  const [hover, setHover] = useState(false);

  if (isMobile) {
    return (
      <div
        onClick={onOpen}
        style={{
          cursor: "pointer",
          display: "flex",
          gap: 12,
          padding: "13px 14px",
          borderBottom: "1px solid var(--border-2)",
          alignItems: "flex-start",
        }}
      >
        <div style={{ position: "relative", flex: "none" }}>
          <div
            style={{
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
          {row.unread && (
            <span
              style={{
                position: "absolute",
                top: -1,
                right: -1,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--accent)",
                border: "2px solid var(--surface)",
              }}
            />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 14.5,
                fontWeight: row.unread ? 700 : 600,
                color: "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {row.customerName ?? row.customerEmail ?? "Unknown"}
            </span>
            <span style={{ flex: "none", fontSize: 12, color: "var(--text-3)" }}>
              {shortTime(row.lastMessageAt)}
            </span>
          </div>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: row.unread ? 700 : 600,
              color: "var(--text)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {row.subject ?? "(no subject)"}
          </div>
          {row.snippet && (
            <div
              style={{
                fontSize: 13,
                color: "var(--text-3)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {row.snippet}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
            {row.category && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 9px",
                  borderRadius: 999,
                  background: cat.bg,
                  color: cat.fg,
                  whiteSpace: "nowrap",
                }}
              >
                {row.category.name}
              </span>
            )}
            <SentimentPill sentiment={row.sentiment} />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 9px",
                borderRadius: 999,
                background: st.bg,
                color: st.fg,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              {statusPulses(row.status) && (
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "currentColor",
                    animation: "pulse 1.3s ease-in-out infinite",
                  }}
                />
              )}
              {statusLabel(row.status)}
            </span>
            {row.confidence && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: confColor(row.confidence),
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: confColor(row.confidence) }}>
                  {confLabel(row.confidence)}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

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
      <div style={{ flex: "none", width: 92, display: "flex" }}>
        <SentimentPill sentiment={row.sentiment} />
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

function CatItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        border: "none",
        background: hover ? "var(--hover)" : "transparent",
        color: active ? "var(--accent-soft-fg)" : "var(--text-2)",
        fontWeight: active ? 600 : 500,
        fontSize: 13,
        padding: "7px 10px",
        borderRadius: 7,
      }}
    >
      {label}
    </button>
  );
}

function NoiseList({
  rows,
  loading,
  isMobile,
  onNotNoise,
  onOpen,
}: {
  rows: ThreadSummaryDTO[];
  loading: boolean;
  isMobile: boolean;
  onNotNoise: (id: string) => void;
  onOpen: (id: string) => void;
}) {
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
        Automatically filtered as noise by your sender rules and AI triage. Found
        a real customer here? Mark it <strong>Not noise</strong>.
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-3)", fontSize: 14 }}>
          {loading ? "Loading…" : "Nothing filtered out yet."}
        </div>
      ) : (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 13,
            overflow: "hidden",
            boxShadow: "var(--shadow)",
          }}
        >
          {rows.map((row) => (
            <NoiseRow
              key={row.id}
              row={row}
              isMobile={isMobile}
              onNotNoise={onNotNoise}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NoiseRow({
  row,
  isMobile,
  onNotNoise,
  onOpen,
}: {
  row: ThreadSummaryDTO;
  isMobile: boolean;
  onNotNoise: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const domain = row.customerEmail?.split("@")[1] ?? "unknown";
  const [hover, setHover] = useState(false);

  if (isMobile) {
    return (
      <div
        onClick={() => onOpen(row.id)}
        style={{ display: "flex", gap: 12, padding: "13px 14px", borderBottom: "1px solid var(--border-2)", alignItems: "flex-start" }}
      >
        <div style={{ flex: "none", width: 38, height: 38, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-3)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>
          {initialsFrom(row.customerName, row.customerEmail)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.customerName ?? row.customerEmail ?? "Unknown"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 6 }}>
            {row.subject ?? "(no subject)"}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontFamily: "var(--mono)", padding: "2px 8px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-3)" }}>
              {domain}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onNotNoise(row.id);
              }}
              style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 500, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-2)" }}
            >
              Not noise?
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => onOpen(row.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "13px 16px",
        borderBottom: "1px solid var(--border-2)",
        opacity: hover ? 1 : 0.82,
        background: hover ? "var(--hover)" : "transparent",
      }}
    >
      <div
        style={{
          flex: "none",
          width: 38,
          height: 38,
          borderRadius: 10,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          color: "var(--text-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        {initialsFrom(row.customerName, row.customerEmail)}
      </div>
      <div style={{ flex: "none", width: 170, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--text-2)",
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
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13.5,
          color: "var(--text-2)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {row.subject ?? "(no subject)"}
      </div>
      <span
        style={{
          flex: "none",
          fontSize: 11,
          fontWeight: 500,
          padding: "3px 10px",
          borderRadius: 999,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          color: "var(--text-3)",
          fontFamily: "var(--mono)",
          whiteSpace: "nowrap",
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={`Domain: ${domain}`}
      >
        {domain}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onNotNoise(row.id);
        }}
        style={{
          flex: "none",
          cursor: "pointer",
          fontSize: 12.5,
          fontWeight: 500,
          padding: "5px 11px",
          borderRadius: 7,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text-2)",
        }}
      >
        Not noise?
      </button>
      <div
        style={{
          flex: "none",
          width: 54,
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
