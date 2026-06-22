import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { api } from "../api";
import { useSync } from "../sync";
import { Shell } from "./Shell";

// Wraps every authenticated screen in the shell and supplies shell-level data
// (needs-review count, Gmail connection status). Refetches when a sync finishes.
export function AppLayout() {
  const { completedAt } = useSync();
  const location = useLocation();
  const [needsReview, setNeedsReview] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(0);
  const [account, setAccount] = useState("Gmail not connected");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [counts, gmail, fb] = await Promise.all([
          api.threadCounts(),
          api.gmailStatus(),
          api.feedbackCounts().catch(() => ({ open: 0, total: 0 })),
        ]);
        if (!active) return;
        setNeedsReview(counts.needsReview);
        setFeedbackOpen(fb.open);
        setConnected(gmail.connected);
        setAccount(
          gmail.connected ? gmail.account : "Gmail not connected",
        );
      } catch {
        /* unauthenticated or transient — shell still renders */
      }
    })();
    return () => {
      active = false;
    };
    // Refetch on sync completion and when navigating (e.g. after acting on feedback).
  }, [completedAt, location.pathname]);

  return (
    <Shell
      needsReviewCount={needsReview}
      feedbackOpen={feedbackOpen}
      connectedAccount={account}
      gmailConnected={connected}
    >
      <Outlet />
    </Shell>
  );
}
