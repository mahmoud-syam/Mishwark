import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { BookingListItem, DriverSummary, FleetItem, FleetSummary, Overview as OverviewData } from "../lib/types";
import { BOOKING_STATUS, DRIVER_STATUS, FLEET_STATUS, ROLE_LABEL } from "../lib/labels";
import {
  addDays,
  compact,
  dayMonth,
  dayOfWeek,
  egp,
  initials,
  monthYear,
  num,
  percentDelta,
  time12,
  todayKey,
  weekdayShort,
} from "../lib/format";
import {
  Avatar,
  Badge,
  BarChart,
  Brand,
  Button,
  cx,
  Empty,
  ErrorBox,
  LinkButton,
  Page,
  Panel,
  Skeleton,
  StatCard,
  StatGrid,
  Table,
  Td,
} from "../components/ui";

export default function Overview() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api.get<OverviewData>("/admin/overview"), refetchInterval: 60_000 });
  const k = overview.data?.kpis;

  return (
    <Page>
      <TopBar liveTrips={k?.liveTrips ?? 0} />

      {overview.error && <ErrorBox error={errorMessage(overview.error)} onRetry={() => overview.refetch()} />}
      <AlertsStrip data={overview.data} />

      <StatGrid>
        <Link to={`/day/${todayKey()}`} className="block rounded-2xl transition hover:brightness-110" aria-label="تفاصيل حجوزات النهاردة">
          <TodayCard loading={overview.isPending} today={k?.todayBookings} yesterday={k?.yesterdayBookings} />
        </Link>
        <StatCard
          loading={overview.isPending}
          label="السيارات المتاحة"
          tone="cream"
          value={k ? `${k.availableVehicles} / ${k.totalVehicles}` : ""}
          delta={k ? `${k.bookedVehicles} محجوزة حاليًا${k.maintenanceVehicles ? ` · ${k.maintenanceVehicles} صيانة` : ""}` : ""}
        />
        <RevenueCard loading={overview.isPending} current={k?.monthRevenue} previous={k?.lastMonthRevenue} />
        <StatCard loading={overview.isPending} label="معدل الإشغال" value={k ? `${k.occupancyRate}%` : ""} delta="متوسط آخر 7 أيام" />
      </StatGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <CalendarPanel />
          <RecentBookingsPanel />
          <WeeklyRevenuePanel data={overview.data?.weeklyRevenue} loading={overview.isPending} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <FleetPanel />
          <DriversPanel />
        </div>
      </div>
    </Page>
  );
}

// ----------------------------------------------------------------- top bar
function TopBar({ liveTrips }: { liveTrips: number }) {
  const { me, logout, isSuperAdmin } = useAuth();
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="text-[12px] uppercase tracking-[2px] text-gold">
          <span dir="ltr">{ROLE_LABEL[me?.role?.name ?? ""] ?? "Admin"}</span>
          {me?.name && <span className="normal-case tracking-normal text-muted"> · {me.name}</span>}
        </div>
        <h1 className="font-display text-[30px] leading-tight text-cream">لوحة التحكم</h1>
      </div>
      <nav className="flex flex-wrap items-center gap-2" aria-label="التنقل الرئيسي">
        <LinkButton to="/book" variant="primary">+ احجز لعميل</LinkButton>
        <LinkButton to="/live">
          <span className={cx("inline-block size-2 rounded-full bg-[#e2453c]", liveTrips > 0 && "pulse-dot")} />
          الرحلات الجارية{liveTrips > 0 && <span className="text-gold">({liveTrips})</span>}
        </LinkButton>
        <LinkButton to="/audit">📋 سجل التوثيق</LinkButton>
        <LinkButton to="/fleet">🚗 الأسطول</LinkButton>
        <LinkButton to="/packages">🎁 الباكدجات</LinkButton>
        <LinkButton to="/settings">⚙️ الإعدادات</LinkButton>
        {isSuperAdmin && <LinkButton to="/team">👥 الفريق</LinkButton>}
        <span className="mx-1 hidden sm:block">
          <Brand />
        </span>
        <Button variant="ghost" size="sm" onClick={logout} title="تسجيل الخروج">
          خروج
        </Button>
      </nav>
    </header>
  );
}

// ------------------------------------------------------------------ alerts
function AlertsStrip({ data }: { data?: OverviewData }) {
  if (!data || data.alerts.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
      {data.alerts.map((a, i) =>
        a.type === "maintenance" ? (
          <div key={i} className="flex items-center gap-2 rounded-xl border border-gold bg-gold/15 px-4 py-3 text-[11px] text-gold">
            <span aria-hidden>🔧</span>
            <span>
              {a.vehicleName} {a.daysUntil === 0 ? "داخلة صيانة مجدولة النهاردة" : a.daysUntil === 1 ? "هتدخل صيانة مجدولة بكرة" : `هتدخل صيانة مجدولة بعد ${a.daysUntil} أيام`}
            </span>
          </div>
        ) : a.type === "no_driver" ? (
          <Link
            key={i}
            to={`/fleet/${a.entityId}`}
            className="flex items-center gap-2 rounded-xl border border-gold bg-gold/15 px-4 py-3 text-[11px] text-gold transition hover:bg-gold/20"
          >
            <span aria-hidden>🚗</span>
            <span>{a.vehicleName} من غير سواق: مش ظاهرة للعملاء. حدد لها سواق</span>
          </Link>
        ) : (
          <Link
            key={i}
            to={`/drivers/${a.entityId}`}
            className="flex items-center gap-2 rounded-xl border border-wine bg-wine/18 px-4 py-3 text-[11px] text-blush transition hover:bg-wine/25"
          >
            <span aria-hidden>⚠️</span>
            <span>
              {a.driverName} عنده شكوى جديدة محتاجة مراجعة <span className="text-rose">({a.rating}★)</span>
            </span>
          </Link>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------- KPI cards
function deltaProps(pct: number | null, suffix: string) {
  if (pct === null) return { delta: "", deltaTone: "muted" as const };
  if (pct === 0) return { delta: `زي ${suffix}`, deltaTone: "muted" as const };
  return pct > 0
    ? { delta: `↑ ${pct}% عن ${suffix}`, deltaTone: "mint" as const }
    : { delta: `↓ ${Math.abs(pct)}% عن ${suffix}`, deltaTone: "rose" as const };
}

function TodayCard({ loading, today, yesterday }: { loading: boolean; today?: number; yesterday?: number }) {
  let d: { delta: string; deltaTone: "muted" | "mint" | "rose" } = { delta: "", deltaTone: "muted" };
  if (today != null && yesterday != null) {
    d = yesterday === 0 ? { delta: today > 0 ? "أمس مكانش فيه حجوزات" : "", deltaTone: "muted" } : deltaProps(percentDelta(today, yesterday), "أمس");
  }
  return <StatCard loading={loading} label="حجوزات اليوم" value={today ?? ""} {...d} />;
}

function RevenueCard({ loading, current, previous }: { loading: boolean; current?: number; previous?: number }) {
  const d = current != null && previous != null ? deltaProps(percentDelta(current, previous), "الشهر اللي فات") : { delta: "", deltaTone: "muted" as const };
  return <StatCard loading={loading} label="إيرادات الشهر" tone="rose" value={current != null ? compact(current) : ""} {...d} />;
}

// ---------------------------------------------------------------- calendar
const BUSY_THRESHOLD = 5;

function CalendarPanel() {
  const nav = useNavigate();
  const [page, setPage] = useState(0);
  const today = todayKey();
  // Weeks start on Saturday, like the Figma calendar.
  const start = addDays(today, -((dayOfWeek(today) + 1) % 7) + page * 14);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(start, i)), [start]);
  const months = Array.from(new Set(days.map((d) => d.slice(0, 7))));

  const results = useQueries({
    queries: months.map((m) => ({
      queryKey: ["calendar", m],
      queryFn: () => api.get<Record<string, number>>(`/admin/bookings/calendar?month=${m}`),
    })),
  });
  const counts: Record<string, number> = Object.assign({}, ...results.map((r) => r.data ?? {}));
  const loading = results.some((r) => r.isPending);

  return (
    <Panel
      title="الحجوزات القادمة"
      tag={
        <span className="flex items-center gap-2">
          <button type="button" className="rounded px-1 text-cream hover:text-gold" onClick={() => setPage((p) => p - 1)} aria-label="الأسبوعين اللي فاتوا">
            ›
          </button>
          <span>{monthYear(days[0])}</span>
          <button type="button" className="rounded px-1 text-cream hover:text-gold" onClick={() => setPage((p) => p + 1)} aria-label="الأسبوعين الجايين">
            ‹
          </button>
        </span>
      }
    >
      <div className="grid grid-cols-7 gap-1.5 sm:gap-1.5">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="pb-1 text-center text-[10px] text-muted">
            {weekdayShort(d)}
          </div>
        ))}
        {days.map((d) => {
          const c = counts[d] ?? 0;
          const busy = c >= BUSY_THRESHOLD;
          const past = d < today;
          return (
            <button
              key={d}
              type="button"
              onClick={() => nav(`/day/${d}`)}
              className={cx(
                "relative flex aspect-square flex-col items-center justify-center rounded-lg text-[11px] transition hover:brightness-125",
                busy ? "border-2 border-wine bg-wine/18 font-bold text-blush shadow-[0_0_0_3px_rgba(139,46,58,0.15)]" : c > 0 ? "border border-gold bg-gold/15 font-bold text-gold" : "bg-raised text-muted",
                past && "opacity-55",
                d === today && "outline outline-1 outline-offset-2 outline-cream/40"
              )}
              aria-label={`${dayMonth(d)}: ${c} حجز`}
            >
              {loading ? <Skeleton className="h-3 w-4" /> : <span className="ltr">{Number(d.slice(8))}</span>}
              {c > 0 && <span className="text-[9px] font-normal">{c} حجز</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-3.5 flex items-center gap-4 text-[10px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] border border-gold bg-gold/15" />
          حجوزات متوسطة
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] border border-wine bg-wine/18" />
          يوم مزدحم
        </span>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------- recent bookings
function RecentBookingsPanel() {
  const q = useQuery({ queryKey: ["recent-bookings"], queryFn: () => api.page<BookingListItem>("/admin/bookings/all?limit=5") });
  const items = q.data?.items ?? [];
  const allRecent = items.length > 0 && items.every((b) => Date.now() - new Date(b.createdAt).getTime() < 86_400_000);
  return (
    <Panel title="أحدث الحجوزات" tag={allRecent ? "آخر 24 ساعة" : "الأحدث"}>
      {q.error ? (
        <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.isPending ? (
        <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : items.length === 0 ? (
        <Empty>لسه مفيش حجوزات.</Empty>
      ) : (
        <Table head={["العميل", "العربية", "الميعاد", "الحالة"]}>
          {items.map((b) => (
            <tr key={b.id} className="transition hover:bg-raised/40">
              <Td>
                <Link to={`/customers/${b.customer.id}`} className="hover:text-gold">
                  {b.customer.name}
                </Link>
              </Td>
              <Td>{`${b.vehicle.make} ${b.vehicle.model}`}</Td>
              <Td>
                <Link to={`/day/${b.bookingDate}?booking=${b.id}`} className="hover:text-gold">
                  {dayMonth(b.bookingDate)}، {time12(b.startTime)}
                </Link>
              </Td>
              <Td>
                <Badge tone={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

// --------------------------------------------------------- weekly revenue
function WeeklyRevenuePanel({ data, loading }: { data?: OverviewData["weeklyRevenue"]; loading: boolean }) {
  const total = data?.reduce((s, d) => s + d.revenue, 0) ?? 0;
  return (
    <Panel title="الإيرادات الأسبوعية" tag={data ? `إجمالي ${egp(total)}` : undefined}>
      {loading || !data ? (
        <Skeleton className="h-[140px]" />
      ) : (
        <BarChart format={(n) => compact(n)} data={data.map((d) => ({ label: weekdayShort(d.date), value: d.revenue, title: `${dayMonth(d.date)}: ${egp(d.revenue)}` }))} />
      )}
    </Panel>
  );
}

// --------------------------------------------------------------- fleet
const FLEET_RANK: Record<string, number> = { MAINTENANCE: 0, BOOKED: 1, AVAILABLE: 2 };

function FleetPanel() {
  const q = useQuery({ queryKey: ["fleet-list", ""], queryFn: () => api.raw<{ data: FleetItem[]; summary: FleetSummary }>("GET", "/admin/vehicles") });
  const list = (q.data?.data ?? []).filter((v) => v.status !== "RETIRED").sort((a, b) => (FLEET_RANK[a.status] ?? 3) - (FLEET_RANK[b.status] ?? 3));

  return (
    <Panel title="حالة الأسطول" tag={q.data ? `${list.length} عربية` : undefined}>
      {q.error ? (
        <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.isPending ? (
        <div className="flex flex-col gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : list.length === 0 ? (
        <Empty>لسه مفيش عربيات مسجّلة.</Empty>
      ) : (
        <ul className="scroll-thin -mx-1 max-h-[300px] overflow-y-auto px-1">
          {list.map((v) => {
            const b = FLEET_STATUS[v.status];
            return (
              <li key={v.id}>
                <Link to={`/fleet/${v.id}`} className="flex w-full items-center justify-between gap-3 border-b border-line py-3 text-right last:border-b-0 hover:bg-raised/30">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-bold text-cream">{v.name}</span>
                    <span className="text-[11px] text-muted">
                      {v.plateNumber.replace(/·D$/, "")}
                      {v.drivers.length === 0 && <span className="text-rose"> · من غير سواق</span>}
                    </span>
                  </span>
                  <Badge tone={b.tone} dot>
                    {b.label}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <LinkButton to="/fleet" className="mt-3 w-full rounded-xl py-3 text-[12px]">
        إدارة الأسطول
      </LinkButton>
    </Panel>
  );
}

// ------------------------------------------------------------- drivers
const avatarTones = ["wine", "gold", "plain"] as const;

function DriversPanel() {
  const q = useQuery({ queryKey: ["drivers-summary", 3], queryFn: () => api.get<DriverSummary[]>("/admin/drivers-summary?limit=3") });
  return (
    <Panel title="تفاصيل السائقين" tag="هذا الشهر" bodyClassName="flex flex-col gap-2.5">
      {q.error ? (
        <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.isPending ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)
      ) : (q.data ?? []).length === 0 ? (
        <Empty>لسه مفيش سائقين.</Empty>
      ) : (
        q.data!.map((d, i) => <DriverCard key={d.id} d={d} tone={avatarTones[i % 3]} />)
      )}
      <LinkButton to="/drivers" className="mt-1 w-full rounded-xl py-3 text-[12px]">
        عرض كل السائقين
      </LinkButton>
    </Panel>
  );
}

export function DriverCard({ d, tone }: { d: DriverSummary; tone: (typeof avatarTones)[number] }) {
  const st = DRIVER_STATUS[d.status];
  return (
    <Link to={`/drivers/${d.id}`} className="lift flex flex-col gap-2.5 rounded-xl border border-line bg-raised px-3 pb-3 pt-4 transition hover:border-gold/50">
      <div className="flex items-center gap-2.5">
        <Avatar text={initials(d.name)} tone={tone} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-cream">{d.name}</div>
          <div className="text-[11px] text-muted">
            ⭐ {d.rating.toFixed(1)} · {st.label}
            {d.statusLocked && <span title="الحالة متحددة من الإدارة"> 🔒</span>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 border-b border-line pb-2.5 text-center">
        <div>
          <div className="text-[14px] font-bold text-gold">{num(d.totalTrips)}</div>
          <div className="text-[9px] text-muted">رحلة</div>
        </div>
        <div>
          <div className="text-[14px] font-bold text-cream">{num(d.monthTrips)}</div>
          <div className="text-[9px] text-muted">رحلات الشهر</div>
        </div>
        <div>
          <div className="text-[14px] font-bold text-rose ltr">{compact(d.monthRevenue)}</div>
          <div className="text-[9px] text-muted">إجمالي ج.م</div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-mint">
          تقييم العملاء له: {d.rating.toFixed(1)} ({d.reviewCount} تقييم)
        </span>
        <span className={d.complaints > 0 ? "text-rose" : "text-muted"}>شكاوى: {d.complaints}</span>
      </div>
    </Link>
  );
}
