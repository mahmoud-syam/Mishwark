import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./lib/auth";
import { BrandMark, Skeleton } from "./components/ui";
import AppShell from "./components/AppShell";
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
const Fleet = lazy(() => import("./pages/Fleet"));
const Team = lazy(() => import("./pages/Team"));
const FleetVehicle = lazy(() => import("./pages/FleetVehicle"));
const Bookings = lazy(() => import("./pages/Bookings"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Profile = lazy(() => import("./pages/Profile"));
const Reviews = lazy(() => import("./pages/Reviews"));

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

/** While a page's code loads, inside the frame. */
function PageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-8 lg:px-8">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-[18px]" />)}
      </div>
      <Skeleton className="h-72 rounded-[18px]" />
    </div>
  );
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return (
    <AppShell>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAdmin><Overview /></RequireAdmin>} />
      <Route path="/day/:date" element={<RequireAdmin><DayDetails /></RequireAdmin>} />
      <Route path="/bookings" element={<RequireAdmin><Bookings /></RequireAdmin>} />
      <Route path="/book" element={<RequireAdmin><BookOnBehalf /></RequireAdmin>} />
      <Route path="/live" element={<RequireAdmin><LiveOps /></RequireAdmin>} />
      <Route path="/drivers" element={<RequireAdmin><Drivers /></RequireAdmin>} />
      <Route path="/drivers/:id" element={<RequireAdmin><DriverAnalytics /></RequireAdmin>} />
      <Route path="/customers/:id" element={<RequireAdmin><CustomerAnalytics /></RequireAdmin>} />
      <Route path="/audit" element={<RequireAdmin><AuditLog /></RequireAdmin>} />
      <Route path="/pricing" element={<RequireAdmin><Pricing /></RequireAdmin>} />
      <Route path="/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
      <Route path="/packages" element={<RequireAdmin><Packages /></RequireAdmin>} />
      <Route path="/team" element={<RequireAdmin><Team /></RequireAdmin>} />
      <Route path="/profile" element={<RequireAdmin><Profile /></RequireAdmin>} />
      <Route path="/reviews" element={<RequireAdmin><Reviews /></RequireAdmin>} />
      <Route path="/fleet" element={<RequireAdmin><Fleet /></RequireAdmin>} />
      <Route path="/fleet/:id" element={<RequireAdmin><FleetVehicle /></RequireAdmin>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
