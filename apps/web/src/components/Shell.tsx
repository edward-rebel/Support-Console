import { type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTheme } from "../theme";
import { useAuth } from "../auth";
import { useSync } from "../sync";
import {
  BarChartIcon,
  BookIcon,
  CheckCircleIcon,
  InboxIcon,
  MoonIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from "../icons";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  count?: number;
}

export function Shell({
  children,
  needsReviewCount,
  connectedAccount,
  gmailConnected,
}: {
  children: ReactNode;
  needsReviewCount: number;
  connectedAccount: string;
  gmailConnected: boolean;
}) {
  const { theme, toggle } = useTheme();
  const { user } = useAuth();
  const { syncing, triggerSync } = useSync();
  const location = useLocation();

  const navItems: NavItem[] = [
    { to: "/inbox", label: "Inbox", icon: <InboxIcon size={18} />, count: needsReviewCount },
    {
      to: "/approvals",
      label: "Approvals",
      icon: <CheckCircleIcon size={18} />,
      count: needsReviewCount,
    },
    { to: "/knowledge", label: "Knowledge Base", icon: <BookIcon size={18} /> },
    { to: "/insights", label: "Insights", icon: <BarChartIcon size={18} /> },
    { to: "/settings", label: "Settings", icon: <SettingsIcon size={18} /> },
  ];

  // Inbox is "active" on the review screen too.
  const isActive = (to: string) =>
    location.pathname.startsWith(to) ||
    (to === "/inbox" && location.pathname.startsWith("/review"));

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100%",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--sans)",
        overflow: "hidden",
      }}
    >
      {/* SIDEBAR */}
      <aside
        style={{
          flex: "none",
          width: 248,
          background: "var(--surface-2)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            height: 60,
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "0 18px",
            borderBottom: "1px solid var(--border)",
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
            <div
              style={{
                fontSize: 14.5,
                fontWeight: 700,
                color: "var(--text)",
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
              }}
            >
              Molly &amp; Stitch
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 500 }}>
              Support Console
            </div>
          </div>
        </div>

        <nav
          style={{
            flex: 1,
            padding: "14px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "var(--text-3)",
              padding: "6px 10px 7px",
            }}
          >
            Workspace
          </div>
          {navItems.map((item) => {
            const active = isActive(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "9px 11px",
                  borderRadius: 9,
                  fontSize: 14,
                  fontWeight: 500,
                  background: active ? "var(--surface)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-2)",
                }}
              >
                <span
                  style={{
                    flex: "none",
                    width: 18,
                    height: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {item.icon}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.count ? (
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      fontFamily: "var(--mono)",
                      padding: "1px 7px",
                      borderRadius: 999,
                      background: active
                        ? "var(--accent-soft-bg)"
                        : "var(--surface)",
                      color: active ? "var(--accent-soft-fg)" : "var(--text-3)",
                    }}
                  >
                    {item.count}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 10,
              background: "var(--surface)",
            }}
          >
            <div
              style={{
                flex: "none",
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "var(--cat-sizing-bg)",
                color: "var(--cat-sizing-fg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              {(user?.email ?? "?").slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {user?.email ?? "Operator"}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>Owner</div>
            </div>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--conf-high)",
              }}
            />
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* TOP BAR */}
        <header
          style={{
            flex: "none",
            height: 60,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "0 20px",
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              flex: 1,
              maxWidth: 440,
              display: "flex",
              alignItems: "center",
              gap: 9,
              height: 38,
              padding: "0 13px",
              borderRadius: 9,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
            }}
          >
            <SearchIcon size={16} style={{ color: "var(--text-3)" }} />
            <span style={{ fontSize: 13.5, color: "var(--text-3)" }}>
              Search threads, customers, orders…
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-3)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                padding: "1px 6px",
              }}
            >
              ⌘K
            </span>
          </div>

          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <button
              onClick={() => void triggerSync()}
              disabled={syncing}
              style={{
                cursor: syncing ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 34,
                padding: "0 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text-2)",
                fontSize: 12.5,
                fontWeight: 500,
              }}
            >
              {syncing ? (
                <span
                  style={{
                    width: 14,
                    height: 14,
                    border: "2px solid currentColor",
                    borderRightColor: "transparent",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "spin .7s linear infinite",
                  }}
                />
              ) : (
                <RefreshIcon size={15} />
              )}
              {syncing ? "Syncing…" : "Sync"}
            </button>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 34,
                padding: "0 11px 0 9px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: gmailConnected
                    ? "var(--conf-high)"
                    : "var(--text-3)",
                }}
              />
              <span
                style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}
              >
                {connectedAccount}
              </span>
            </div>

            <button
              onClick={toggle}
              title="Toggle theme"
              style={{
                cursor: "pointer",
                width: 34,
                height: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text-2)",
              }}
            >
              {theme === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
            </button>
          </div>
        </header>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
