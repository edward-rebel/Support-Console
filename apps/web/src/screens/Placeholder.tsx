// Generic "coming in a later phase" screen for destinations not built in
// Phase 0 (Approvals, Knowledge Base, Insights). Keeps the nav complete and
// styled while signalling that the real build lands in its designated phase.
export function Placeholder({
  title,
  phase,
  blurb,
}: {
  title: string;
  phase: string;
  blurb: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        padding: "24px 32px 40px",
      }}
    >
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <h1
          style={{
            margin: "0 0 3px",
            fontSize: 21,
            fontWeight: 700,
            letterSpacing: "-0.015em",
          }}
        >
          {title}
        </h1>
        <div style={{ fontSize: 13.5, color: "var(--text-3)", marginBottom: 24 }}>
          {blurb}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px 20px",
            textAlign: "center",
            background: "var(--surface)",
            border: "1px dashed var(--border)",
            borderRadius: 14,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--accent-soft-fg)",
              background: "var(--accent-soft-bg)",
              padding: "4px 11px",
              borderRadius: 999,
              marginBottom: 14,
            }}
          >
            {phase}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
            {title} is coming soon
          </div>
          <div
            style={{
              fontSize: 14,
              color: "var(--text-3)",
              maxWidth: 420,
              lineHeight: 1.5,
            }}
          >
            This screen is part of a later build phase. Phase 0 ships the inbox and
            thread review wired to your real Gmail data.
          </div>
        </div>
      </div>
    </div>
  );
}
