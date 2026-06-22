import { useEffect, useState } from "react";
import type { InsightsDTO } from "@ms/shared";
import { SENTIMENTS } from "@ms/shared";
import { api } from "../api";
import { useIsMobile } from "../useIsMobile";
import {
  categoryTokens,
  confColor,
  confLabel,
  sentimentLabel,
  sentimentTokens,
  statusLabel,
  statusTokens,
} from "../tokens";

const RANGES: { key: string; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: "18px 20px",
  boxShadow: "var(--shadow)",
};

export function Insights() {
  const isMobile = useIsMobile();
  const [range, setRange] = useState("30d");
  const [data, setData] = useState<InsightsDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api
      .getInsights(range)
      .then((d) => active && setData(d))
      .catch(() => active && setData(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [range]);

  const maxCat = Math.max(1, ...(data?.byCategory.map((c) => c.count) ?? [1]));
  const sentTotal = Math.max(
    1,
    (data?.sentiment.buckets ?? []).reduce((s, b) => s + b.count, 0),
  );

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: isMobile ? "16px 14px 40px" : "24px 32px 48px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: "0 0 3px", fontSize: 21, fontWeight: 700, letterSpacing: "-0.015em" }}>
              Insights
            </h1>
            <div style={{ fontSize: 13.5, color: "var(--text-3)" }}>
              How your support volume, categories, and sentiment are trending.
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 3 }}>
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                style={{
                  cursor: "pointer",
                  border: "none",
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: isMobile ? "8px 10px" : "6px 12px",
                  borderRadius: 7,
                  background: range === r.key ? "var(--surface)" : "transparent",
                  color: range === r.key ? "var(--text)" : "var(--text-3)",
                  boxShadow: range === r.key ? "var(--shadow)" : "none",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {loading || !data ? (
          <div style={{ padding: "60px 0", textAlign: "center", color: "var(--text-3)" }}>
            {loading ? "Loading insights…" : "Couldn't load insights."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* stat tiles */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5, 1fr)", gap: 12 }}>
              <Stat label="Total threads" value={data.totals.total} />
              <Stat label="Customer" value={data.totals.customer} />
              <Stat label="Filtered out" value={data.totals.noise} />
              <Stat label="Replies sent" value={data.activity.sent} />
              <Stat
                label="Approval rate"
                value={`${Math.round(data.activity.approvalRate * 100)}%`}
                hint={`${data.activity.draftsGenerated} drafted`}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
              {/* category volume */}
              <div style={card}>
                <CardTitle>Volume by category</CardTitle>
                {data.byCategory.length === 0 ? (
                  <Empty />
                ) : (
                  data.byCategory.map((c, i) => {
                    const tok = categoryTokens(c.category?.slug);
                    return (
                      <div key={i} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                          <span style={{ color: "var(--text-2)", fontWeight: 600 }}>
                            {c.category?.name ?? "Uncategorized"}
                          </span>
                          <span style={{ color: "var(--text-3)" }}>{c.count}</span>
                        </div>
                        <div style={{ height: 8, borderRadius: 99, background: "var(--surface-2)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(c.count / maxCat) * 100}%`, background: tok.fg, borderRadius: 99 }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* sentiment distribution */}
              <div style={card}>
                <CardTitle>Customer sentiment</CardTitle>
                {data.sentiment.buckets.length === 0 ? (
                  <Empty note="No sentiment yet — runs as threads are triaged." />
                ) : (
                  <>
                    <div style={{ display: "flex", height: 12, borderRadius: 99, overflow: "hidden", marginBottom: 14, background: "var(--surface-2)" }}>
                      {SENTIMENTS.map((s) => {
                        const n = data.sentiment.buckets.find((b) => b.sentiment === s)?.count ?? 0;
                        if (!n) return null;
                        return <div key={s} title={`${sentimentLabel(s)}: ${n}`} style={{ width: `${(n / sentTotal) * 100}%`, background: sentimentTokens(s).fg }} />;
                      })}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {SENTIMENTS.map((s) => {
                        const n = data.sentiment.buckets.find((b) => b.sentiment === s)?.count ?? 0;
                        const tok = sentimentTokens(s);
                        return (
                          <span key={s} style={{ fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 999, background: tok.bg, color: tok.fg }}>
                            {sentimentLabel(s)} {n}
                          </span>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* trend */}
            <div style={card}>
              <CardTitle>Received vs. sent</CardTitle>
              <Sparkline trend={data.trend} />
              <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "var(--text-3)" }}>
                <Legend color="var(--cat-shipping-fg)" label="Received" />
                <Legend color="var(--accent)" label="Sent" />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
              {/* status breakdown */}
              <div style={card}>
                <CardTitle>Status breakdown</CardTitle>
                {data.byStatus.map((s) => {
                  const tok = statusTokens(s.status);
                  return (
                    <div key={s.status} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: tok.bg, color: tok.fg, minWidth: 92, textAlign: "center" }}>
                        {statusLabel(s.status)}
                      </span>
                      <span style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 600 }}>{s.count}</span>
                    </div>
                  );
                })}
              </div>

              {/* draft activity */}
              <div style={card}>
                <CardTitle>Draft activity</CardTitle>
                <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 12 }}>
                  <b>{data.activity.draftsGenerated}</b> drafts generated · <b>{data.activity.sent}</b> sent
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Confidence mix
                </div>
                {data.activity.confidenceMix.map((c) => (
                  <div key={c.level} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: confColor(c.level) }} />
                    <span style={{ fontSize: 13, color: "var(--text-2)" }}>{confLabel(c.level)}</span>
                    <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600 }}>{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div style={{ ...card, padding: "14px 16px" }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 14 }}>{children}</div>;
}
function Empty({ note }: { note?: string }) {
  return <div style={{ fontSize: 13, color: "var(--text-3)" }}>{note ?? "No data in this range yet."}</div>;
}
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 3, borderRadius: 2, background: color }} /> {label}
    </span>
  );
}

function Sparkline({ trend }: { trend: { date: string; received: number; sent: number }[] }) {
  const W = 720;
  const H = 90;
  const n = Math.max(1, trend.length - 1);
  const max = Math.max(1, ...trend.flatMap((t) => [t.received, t.sent]));
  const path = (key: "received" | "sent") =>
    trend
      .map((t, i) => {
        const x = (i / n) * W;
        const y = H - (t[key] / max) * (H - 8) - 4;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
      <path d={path("received")} fill="none" stroke="var(--cat-shipping-fg)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <path d={path("sent")} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
