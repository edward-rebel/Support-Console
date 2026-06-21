import { useState } from "react";
import { useAuth } from "../auth";
import { ApiError } from "../api";

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not sign in. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 40,
    padding: "0 13px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--surface-2)",
    color: "var(--text)",
    fontSize: 14,
    fontFamily: "var(--sans)",
    marginBottom: 12,
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: 360,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: "28px 26px",
          boxShadow: "0 4px 20px rgba(40,38,34,.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            marginBottom: 22,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "var(--accent)",
              color: "var(--accent-fg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            M
          </div>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Molly &amp; Stitch</div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 500 }}>
              Support Console
            </div>
          </div>
        </div>

        <label style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 600 }}>
          Email
        </label>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ ...inputStyle, marginTop: 6 }}
          required
        />
        <label style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 600 }}>
          Password
        </label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...inputStyle, marginTop: 6 }}
          required
        />

        {error && (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--cat-exchange-fg)",
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            border: "none",
            cursor: busy ? "default" : "pointer",
            background: "var(--accent)",
            color: "var(--accent-fg)",
            fontSize: 14.5,
            fontWeight: 600,
            padding: "11px 0",
            borderRadius: 9,
            marginTop: 4,
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
