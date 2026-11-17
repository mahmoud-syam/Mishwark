import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Car,
  ClipboardList,
  Gift,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Radio,
  Settings,
  ShieldCheck,
  Sun,
  CalendarPlus,
  Users,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { initials } from "../lib/format";
import { ROLE_LABEL } from "../lib/labels";
import type { Overview } from "../lib/types";
import { BrandMark, cx } from "./ui";

type Item = { to: string; label: string; icon: ReactNode; end?: boolean; badge?: number; superOnly?: boolean };

/**
 * The dashboard frame: a navy side menu (on the right, as the page is RTL)
 * and the page beside it. On small screens the menu opens from a button.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="flex min-h-dvh">
      {/* desktop */}
      <aside className="hidden w-[248px] shrink-0 bg-[var(--c-sidebar)] lg:block">
        <div className="sticky top-0 h-dvh">
          <Sidebar />
        </div>
      </aside>

      {/* mobile */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <span className="flex items-center gap-2">
          <BrandMark size={28} />
          <span className="text-[15px] font-bold text-cream" dir="ltr">Mishwark</span>
        </span>
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-2 text-cream hover:bg-raised" aria-label="فتح القايمة">
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="القايمة">
          <button type="button" className="fade-in absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-label="قفل القايمة" />
          <div className="drawer-in absolute inset-y-0 right-0 w-[260px] max-w-[85vw]">
            <Sidebar onClose={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 pt-14 lg:pt-0">{children}</main>
    </div>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const { me, isSuperAdmin, logout } = useAuth();
  const { theme, toggle } = useTheme();
  // Shares the Overview's cache; refreshed every minute for the live-trips count.
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api.get<Overview>("/admin/overview"), refetchInterval: 60_000 });
  const live = overview.data?.kpis.liveTrips ?? 0;
  const alerts = overview.data?.alerts.length ?? 0;

  const main: Item[] = [
    { to: "/", label: "الرئيسية", icon: <LayoutDashboard />, end: true, badge: alerts },
    { to: "/book", label: "احجز لعميل", icon: <CalendarPlus /> },
    { to: "/live", label: "الرحلات الجارية", icon: <Radio />, badge: live },
    { to: "/drivers", label: "السواقين", icon: <Users /> },
    { to: "/fleet", label: "الأسطول", icon: <Car /> },
    { to: "/packages", label: "الباكدجات", icon: <Gift /> },
    { to: "/audit", label: "سجل التوثيق", icon: <ClipboardList /> },
  ];
  const bottom: Item[] = [
    { to: "/settings", label: "الإعدادات", icon: <Settings /> },
    { to: "/team", label: "الفريق", icon: <ShieldCheck />, superOnly: true },
  ];

  return (
    <nav className="flex h-full flex-col bg-[var(--c-sidebar)] px-4 py-6 text-white" aria-label="التنقل الرئيسي">
      <div className="mb-8 flex items-center justify-between px-2">
        <span className="flex items-center gap-2.5">
          <BrandMark size={34} />
          <span className="text-[18px] font-bold" dir="ltr">
            Mishwark
          </span>
        </span>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label="قفل القايمة">
            <X className="size-5" />
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {main.map((i) => (
          <NavItem key={i.to} item={i} />
        ))}
      </ul>

      <div className="mt-auto flex flex-col gap-1 border-t border-white/10 pt-4">
        <ul className="flex flex-col gap-1">
          {bottom
            .filter((i) => !i.superOnly || isSuperAdmin)
            .map((i) => (
              <NavItem key={i.to} item={i} />
            ))}
        </ul>
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] text-white/75 transition hover:bg-white/8 hover:text-white [&_svg]:size-[18px]"
          aria-label={theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
          {theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}
        </button>

        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-white/8 p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-linear-135 from-gold to-gold-deep text-[12px] font-bold text-white">
            {initials(me?.name ?? "")}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-bold">{me?.name}</span>
            <span className="text-[10px] text-white/60" dir="ltr">
              {ROLE_LABEL[me?.role?.name ?? ""] ?? ""}
            </span>
          </span>
          <button type="button" onClick={logout} className="rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white" title="تسجيل الخروج" aria-label="تسجيل الخروج">
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </div>
    </nav>
  );
}

function NavItem({ item }: { item: Item }) {
  return (
    <li>
      <NavLink
        to={item.to}
        end={item.end}
        className={({ isActive }) =>
          cx(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition [&_svg]:size-[18px]",
            isActive
              ? "bg-linear-to-l from-gold to-gold-deep font-bold text-white shadow-[0_10px_22px_-12px_var(--color-gold)]"
              : "text-white/75 hover:bg-white/8 hover:text-white"
          )
        }
      >
        {item.icon}
        <span className="flex-1">{item.label}</span>
        {!!item.badge && (
          <span className="flex min-w-5 items-center justify-center rounded-full bg-white/90 px-1.5 text-[10px] font-bold text-navy dark:bg-gold dark:text-white">{item.badge}</span>
        )}
      </NavLink>
    </li>
  );
}
