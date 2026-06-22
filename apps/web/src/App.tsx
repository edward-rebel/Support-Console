import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { SyncProvider } from "./sync";
import { AppLayout } from "./components/AppLayout";
import { Login } from "./screens/Login";
import { Inbox } from "./screens/Inbox";
import { Review } from "./screens/Review";
import { Settings } from "./screens/Settings";
import { Knowledge } from "./screens/Knowledge";
import { Insights } from "./screens/Insights";
import { Approvals } from "./screens/Approvals";

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-3)",
          fontFamily: "var(--sans)",
        }}
      >
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <SyncProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/review/:id" element={<Review />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Route>
      </Routes>
    </SyncProvider>
  );
}
