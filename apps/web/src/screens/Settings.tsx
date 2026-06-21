import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type GmailStatus } from "../api";
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
                    ? "Read-only access"
                    : "Not connected"
                  : "OAuth not configured (set GOOGLE_CLIENT_ID/SECRET)"}
              </div>
            </div>
            {gmail?.connected ? (
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
