import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./lib/auth";
import { BrandMark, Skeleton } from "./components/ui";
import Login from "./pages/Login";
import Overview from "./pages/Overview";

const DayDetails = lazy(() => import("./pages/DayDetails"));
const BookOnBehalf = lazy(() => import("./pages/BookOnBehalf"));
const LiveOps = lazy(() => import("./pages/LiveOps"));
const DriverAnalytics = lazy(() => import("./pages/DriverAnalytics"));
const CustomerAnalytics = lazy(() => import("./pages/CustomerAnalytics"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Drivers = lazy(() => import("./pages/Drivers"));
const Settings = lazy(() => import("./pages/Settings"));
const Packages = lazy(() => import("./pages/Packages"));

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <BrandMark size={48} />
        <Skeleton className="h-2 w-24" />
      </div>
    </div>
  );
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Suspense fallback={<Splash />}>{children}</Suspense>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAdmin><Overview /></RequireAdmin>} />
      <Route path="/day/:date" element={<RequireAdmin><DayDetails /></RequireAdmin>} />
      <Route path="/book" element={<RequireAdmin><BookOnBehalf /></RequireAdmin>} />
      <Route path="/live" element={<RequireAdmin><LiveOps /></RequireAdmin>} />
      <Route path="/drivers" element={<RequireAdmin><Drivers /></RequireAdmin>} />
      <Route path="/drivers/:id" element={<RequireAdmin><DriverAnalytics /></RequireAdmin>} />
      <Route path="/customers/:id" element={<RequireAdmin><CustomerAnalytics /></RequireAdmin>} />
      <Route path="/audit" element={<RequireAdmin><AuditLog /></RequireAdmin>} />
      <Route path="/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
      <Route path="/packages" element={<RequireAdmin><Packages /></RequireAdmin>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
