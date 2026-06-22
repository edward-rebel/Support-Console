import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type GmailStatus, type SenderRuleDTO } from "../api";
import { useAuth } from "../auth";
import { MailIcon } from "../icons";

export function Settings() {
  const { logout } = useAuth();
  const [params] = useSearchParams();
  const [gmail, setGmail] = useState<GmailStatus | null>(null);

  useEffect(() => {
    void api.gmailStatus().then(setGmail).catch(() => setGmail(null));
  }, []);

  const banner =
    params.get("gmail") === "connected"
      ? { text: "Gmail connected successfully.", ok: true }
      : params.get("gmail") === "no_refresh"
        ? {
            text: "Google didn't return a refresh token. Remove the app's access in your Google account, then reconnect.",
            ok: false,
          }
        : params.get("gmail") === "error"
          ? { text: "Gmail connection was cancelled or failed.", ok: false }
          : null;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px 32px 40px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <h1
            style={{
              margin: "0 0 3px",
              fontSize: 21,
              fontWeight: 700,
              letterSpacing: "-0.015em",
            }}
          >
            Settings
          </h1>
          <div style={{ fontSize: 13.5, color: "var(--text-3)" }}>
            Connections and configuration
          </div>
        </div>

        {banner && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              borderRadius: 10,
              fontSize: 13,
              background: banner.ok ? "var(--accent-soft-bg)" : "var(--warn-bg)",
              color: banner.ok ? "var(--accent-soft-fg)" : "var(--warn-tx)",
              border: `1px solid ${banner.ok ? "transparent" : "var(--warn-bd)"}`,
            }}
          >
            {banner.text}
          </div>
        )}

        {/* Connections */}
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            padding: "20px 22px",
            boxShadow: "var(--shadow)",
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 16 }}>
            Connections
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 13,
              padding: "12px 0",
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                background: "var(--cat-shipping-bg)",
                color: "var(--cat-shipping-fg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MailIcon size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Gmail</div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
                {gmail?.account ?? "contact@mollyandstitch.us"} ·{" "}
                {gmail?.configured
                  ? gmail.connected
                    ? gmail.canSend
                      ? "Read + send access"
                      : "Read-only — reconnect to enable sending"
                    : "Not connected"
                  : "OAuth not configured (set GOOGLE_CLIENT_ID/SECRET)"}
              </div>
            </div>
            {gmail?.connected && gmail.canSend ? (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "4px 11px",
                  borderRadius: 999,
                  background: "var(--accent-soft-bg)",
                  color: "var(--accent-soft-fg)",
                }}
              >
                Connected
              </span>
            ) : gmail?.connected && !gmail.canSend ? (
              <a
                href={api.gmailConnectUrl()}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "8px 14px",
                  borderRadius: 9,
                  background: "var(--accent)",
                  color: "var(--accent-fg)",
                }}
              >
                Reconnect to enable sending
              </a>
            ) : (
              <a
                href={api.gmailConnectUrl()}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "8px 14px",
                  borderRadius: 9,
                  background: "var(--accent)",
                  color: "var(--accent-fg)",
                  pointerEvents: gmail?.configured ? "auto" : "none",
                  opacity: gmail?.configured ? 1 : 0.5,
                }}
              >
                Connect Gmail
              </a>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 13,
              padding: "12px 0",
              borderTop: "1px solid var(--border-2)",
              opacity: 0.7,
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                background: "var(--cat-other-bg)",
                color: "var(--cat-other-fg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
              }}
            >
              S
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Shopify</div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
                Read-only · arrives in Phase 4
              </div>
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "4px 11px",
                borderRadius: 999,
                background: "var(--st-dismissed-bg)",
                color: "var(--st-dismissed-fg)",
              }}
            >
              Not connected
            </span>
          </div>
        </div>

        <SenderRulesCard />

        <button
          onClick={() => void logout()}
          style={{
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            padding: "9px 16px",
            borderRadius: 9,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text-2)",
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function SenderRulesCard() {
  const [rules, setRules] = useState<SenderRuleDTO[]>([]);
  const [pattern, setPattern] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listSenderRules()
      .then(setRules)
      .catch(() => setRules([]));
  useEffect(() => {
    void load();
  }, []);

  const add = async (rule: "allow" | "block") => {
    const p = pattern.trim();
    if (!p || busy) return;
    setBusy(true);
    try {
      await api.addSenderRule(p, rule);
      setPattern("");
      await load();
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
    try {
      await api.deleteSenderRule(id);
    } finally {
      await load();
    }
  };

  const allow = rules.filter((r) => r.rule === "allow");
  const block = rules.filter((r) => r.rule === "block");

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "20px 22px",
        boxShadow: "var(--shadow)",
        marginBottom: 18,
      }}
    >
      <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 4 }}>
        Sender rules
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 16 }}>
        The triage gate. Allowed senders are always treated as customers; filtered
        senders are always treated as noise. Everything else is judged by the AI.
        Use a domain (e.g. <span style={{ fontFamily: "var(--mono)" }}>getredo.com</span>)
        or a full address.
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="domain.com or name@domain.com"
          style={{
            flex: 1,
            minWidth: 180,
            height: 36,
            padding: "0 12px",
            borderRadius: 9,
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            color: "var(--text)",
            fontSize: 13,
            fontFamily: "var(--mono)",
          }}
        />
        <button
          onClick={() => void add("allow")}
          disabled={busy}
          style={ruleBtn("var(--accent-soft-bg)", "var(--accent-soft-fg)")}
        >
          + Always a customer
        </button>
        <button
          onClick={() => void add("block")}
          disabled={busy}
          style={ruleBtn("var(--cat-exchange-bg)", "var(--cat-exchange-fg)")}
        >
          + Always filter out
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 18,
        }}
      >
        <RuleColumn
          title={`Always a customer · ${allow.length}`}
          color="var(--conf-high)"
          rules={allow}
          onRemove={remove}
        />
        <RuleColumn
          title={`Always filter out · ${block.length}`}
          color="var(--cat-exchange-fg)"
          rules={block}
          onRemove={remove}
        />
      </div>
    </div>
  );
}

function ruleBtn(bg: string, fg: string): React.CSSProperties {
  return {
    cursor: "pointer",
    fontSize: 12.5,
    fontWeight: 600,
    padding: "0 13px",
    height: 36,
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: bg,
    color: fg,
    whiteSpace: "nowrap",
  };
}

function RuleColumn({
  title,
  color,
  rules,
  onRemove,
}: {
  title: string;
  color: string;
  rules: SenderRuleDTO[];
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color,
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {rules.length === 0 && (
          <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>None yet.</span>
        )}
        {rules.map((r) => (
          <span
            key={r.id}
            title={r.note ?? undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontFamily: "var(--mono)",
              fontSize: 12,
              padding: "4px 6px 4px 10px",
              borderRadius: 999,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-2)",
            }}
          >
            {r.pattern}
            <button
              onClick={() => onRemove(r.id)}
              aria-label="Remove rule"
              style={{
                cursor: "pointer",
                border: "none",
                background: "transparent",
                color: "var(--text-3)",
                fontSize: 14,
                lineHeight: 1,
                padding: "0 2px",
              }}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
