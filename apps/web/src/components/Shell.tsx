import { type ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTheme } from "../theme";
import { useAuth } from "../auth";
import { useSync } from "../sync";
import { useIsMobile } from "../useIsMobile";
import { SearchOverlay } from "./SearchOverlay";

// "Synced 3m ago" style relative label.
function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "Never synced";
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Synced just now";
  if (m < 60) return `Synced ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Synced ${h}h ago`;
  return `Synced ${Math.floor(h / 24)}d ago`;
}
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
  const { syncing, triggerSync, lastSyncAt } = useSync();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick so the "Synced Xm ago" label stays fresh, and ⌘K opens search.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const syncedLabel = relativeTime(lastSyncAt, now);

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

  const isActive = (to: string) =>
    location.pathname.startsWith(to) ||
    (to === "/inbox" && location.pathname.startsWith("/review"));

  // Sidebar inner content — reused by the desktop aside and the mobile drawer.
  const sidebarContent = (
    <>
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
              onClick={() => setDrawerOpen(false)}
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
    </>
  );

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
      {/* Desktop sidebar (static) */}
      {!isMobile && (
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
          {sidebarContent}
        </aside>
      )}

      {/* Mobile drawer + backdrop */}
      {isMobile && drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(20,18,14,.4)",
              zIndex: 40,
              animation: "fadein .14s",
            }}
          />
          <aside
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              width: 264,
              maxWidth: "82%",
              background: "var(--surface-2)",
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              zIndex: 41,
              boxShadow: "0 12px 30px rgba(20,18,14,.28)",
            }}
          >
            {sidebarContent}
          </aside>
        </>
      )}

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
            gap: isMobile ? 10 : 14,
            padding: isMobile ? "0 14px" : "0 20px",
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {isMobile ? (
            <>
              <button
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                style={{
                  cursor: "pointer",
                  width: 38,
                  height: 38,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 9,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text-2)",
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                >
                  <path d="M3 6h18M3 12h18M3 18h18" />
                </svg>
              </button>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    background: "var(--accent)",
                    color: "var(--accent-fg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 13,
                    flex: "none",
                  }}
                >
                  M
                </div>
                <span
                  style={{
                    fontSize: 14.5,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Molly &amp; Stitch
                </span>
              </div>
            </>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              style={{
                flex: 1,
                maxWidth: 440,
                cursor: "pointer",
                textAlign: "left",
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
                Search threads, customers…
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
            </button>
          )}

          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 8 : 10,
            }}
          >
            {isMobile && (
              <button
                onClick={() => setSearchOpen(true)}
                aria-label="Search"
                style={{
                  cursor: "pointer",
                  width: 40,
                  height: 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 9,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text-2)",
                }}
              >
                <SearchIcon size={16} />
              </button>
            )}
            {!isMobile && (
              <span
                style={{ fontSize: 11.5, color: "var(--text-3)", whiteSpace: "nowrap" }}
                title={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : undefined}
              >
                {syncing ? "Syncing…" : syncedLabel}
              </span>
            )}
            <button
              onClick={() => void triggerSync()}
              disabled={syncing}
              aria-label="Sync"
              title={isMobile ? syncedLabel : undefined}
              style={{
                cursor: syncing ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: isMobile ? 38 : 34,
                width: isMobile ? 38 : undefined,
                justifyContent: "center",
                padding: isMobile ? 0 : "0 12px",
                borderRadius: isMobile ? 9 : 8,
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
              {!isMobile && (syncing ? "Syncing…" : "Sync")}
            </button>

            {!isMobile && (
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
            )}

            <button
              onClick={toggle}
              title="Toggle theme"
              aria-label="Toggle theme"
              style={{
                cursor: "pointer",
                width: isMobile ? 38 : 34,
                height: isMobile ? 38 : 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: isMobile ? 9 : 8,
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

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
