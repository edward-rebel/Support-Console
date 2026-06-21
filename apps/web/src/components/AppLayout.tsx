import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { api } from "../api";
import { useSync } from "../sync";
import { Shell } from "./Shell";

// Wraps every authenticated screen in the shell and supplies shell-level data
// (needs-review count, Gmail connection status). Refetches when a sync finishes.
export function AppLayout() {
  const { completedAt } = useSync();
  const [needsReview, setNeedsReview] = useState(0);
  const [account, setAccount] = useState("Gmail not connected");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [threads, gmail] = await Promise.all([
          api.listThreads({ status: "needs_review" }),
          api.gmailStatus(),
        ]);
        if (!active) return;
        setNeedsReview(threads.total);
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
  }, [completedAt]);

  return (
    <Shell
      needsReviewCount={needsReview}
      connectedAccount={account}
      gmailConnected={connected}
    >
      <Outlet />
    </Shell>
  );
}
