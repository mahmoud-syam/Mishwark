import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, Car, ChevronLeft, Gauge, MessageSquareWarning, Plus, UserX, Wallet, Wrench } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { BookingListItem, DayDetails, DriverSummary, Overview as OverviewData } from "../lib/types";
import { BOOKING_STATUS, DRIVER_STATUS } from "../lib/labels";
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
  weekdayFull,
  weekdayShort,
} from "../lib/format";
import {
  Avatar,
  Badge,
  BarChart,
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
      <Greeting />
      {overview.error && <ErrorBox error={errorMessage(overview.error)} onRetry={() => overview.refetch()} />}
      <AlertsStrip data={overview.data} />

      <StatGrid>
        <Link to={`/day/${todayKey()}`} className="block rounded-[18px] transition hover:brightness-[1.02]" aria-label="تفاصيل حجوزات النهاردة">
          <TodayCard loading={overview.isPending} today={k?.todayBookings} yesterday={k?.yesterdayBookings} />
        </Link>
        <RevenueCard loading={overview.isPending} current={k?.monthRevenue} previous={k?.lastMonthRevenue} />
        <StatCard
          loading={overview.isPending}
          icon={<Car />}
          label="السيارات المتاحة"
          value={k ? `${k.availableVehicles} / ${k.totalVehicles}` : ""}
          delta={k ? `${k.bookedVehicles} محجوزة${k.maintenanceVehicles ? ` · ${k.maintenanceVehicles} صيانة` : ""}` : ""}
        />
        <StatCard loading={overview.isPending} icon={<Gauge />} label="معدل الإشغال" value={k ? `${k.occupancyRate}%` : ""} delta="متوسط آخر 7 أيام" />
      </StatGrid>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <RevenuePanel data={overview.data?.weeklyRevenue} loading={overview.isPending} />
          <CalendarPanel />
          <RecentBookingsPanel />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <FleetDonut data={overview.data} loading={overview.isPending} />
          <TodayPanel />
          <DriversPanel />
        </div>
      </div>
    </Page>
  );
}

// ----------------------------------------------------------------- greeting
function Greeting() {
  const { me } = useAuth();
  const first = (me?.name ?? "").split(/\s+/)[0];
  const today = todayKey();
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-linear-135 from-navy to-navy-soft text-[19px] font-bold text-white shadow-[var(--shadow-card)]">
          {initials(me?.name ?? "")}
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-[27px] leading-tight text-cream">
            أهلًا، <span className="font-bold text-gold">{first}</span>
          </h1>
          <p className="text-[14px] text-muted">
            {weekdayFull(today)}، {dayMonth(today)} · تابع شغل النهاردة من هنا
          </p>
        </div>
      </div>
      <LinkButton to="/book" variant="primary" className="rounded-xl px-5 py-3 text-[14px]">
        <Plus className="size-4" /> احجز لعميل
      </LinkButton>
    </header>
  );
}

// ------------------------------------------------------------------ alerts
function AlertsStrip({ data }: { data?: OverviewData }) {
  if (!data || data.alerts.length === 0) return null;
  const row = "card flex items-center gap-3 px-4 py-3 text-[14px] text-cream transition hover:border-gold/50";
  const icon = (tone: string, node: ReactNode) => <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", tone)}>{node}</span>;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {data.alerts.map((a, i) =>
        a.type === "maintenance" ? (
          <Link key={i} to={`/fleet/${a.entityId}`} className={row}>
            {icon("bg-amber/15 text-amber", <Wrench />)}
            <span>
              {a.vehicleName} {a.daysUntil === 0 ? "داخلة صيانة مجدولة النهاردة" : a.daysUntil === 1 ? "هتدخل صيانة مجدولة بكرة" : `هتدخل صيانة مجدولة بعد ${a.daysUntil} أيام`}
            </span>
          </Link>
        ) : a.type === "driver_unavailable" ? (
          <Link key={i} to={`/drivers/${a.entityId}`} className={row}>
            {icon("bg-wine/12 text-rose", <UserX />)}
            <span>
              {a.driverName} {a.driverStatus === "ONLEAVE" ? "في إجازة" : "خارج الخدمة"} وعليه {a.trips} {a.trips === 1 ? "رحلة جاية" : "رحلات جاية"} (أولها {dayMonth(a.firstDate)}). انقلها لسواق تاني
            </span>
          </Link>
        ) : a.type === "no_driver" ? (
          <Link key={i} to={`/fleet/${a.entityId}`} className={row}>
            {icon("bg-gold/15 text-gold", <AlertTriangle />)}
            <span>{a.vehicleName} من غير سواق: مش ظاهرة للعملاء. حدد لها سواق</span>
          </Link>
        ) : (
          <Link key={i} to={`/drivers/${a.entityId}`} className={row}>
            {icon("bg-wine/12 text-rose", <MessageSquareWarning />)}
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
  return <StatCard loading={loading} icon={<CalendarCheck />} label="حجوزات اليوم" value={today ?? ""} {...d} />;
}

function RevenueCard({ loading, current, previous }: { loading: boolean; current?: number; previous?: number }) {
  const d = current != null && previous != null ? deltaProps(percentDelta(current, previous), "الشهر اللي فات") : { delta: "", deltaTone: "muted" as const };
  return <StatCard loading={loading} icon={<Wallet />} label="إيرادات الشهر" value={current != null ? compact(current) : ""} {...d} />;
}

// ------------------------------------------------------------- revenue chart
function RevenuePanel({ data, loading }: { data?: OverviewData["weeklyRevenue"]; loading: boolean }) {
  const total = data?.reduce((s, d) => s + d.revenue, 0) ?? 0;
  const today = todayKey();
  const hot = data ? Math.max(0, data.findIndex((d) => d.date === today)) : undefined;
  return (
    <Panel
      title={
        <span className="flex flex-col gap-0.5">
          <span>الإيرادات</span>
          <span className="text-[13px] font-normal text-muted">آخر 7 أيام</span>
        </span>
      }
      tag={data ? <span className="text-[14px]">الإجمالي: <b className="text-cream">{egp(total)}</b></span> : undefined}
    >
      {loading || !data ? (
        <Skeleton className="h-[190px]" />
      ) : (
        <BarChart
          height={170}
          format={(n) => compact(n)}
          highlight={hot}
          data={data.map((d) => ({ label: weekdayShort(d.date), value: d.revenue, caption: dayMonth(d.date), title: `${dayMonth(d.date)}: ${egp(d.revenue)}` }))}
        />
      )}
    </Panel>
  );
}

// ------------------------------------------------------------- fleet donut
function FleetDonut({ data, loading }: { data?: OverviewData; loading: boolean }) {
  const k = data?.kpis;
  const parts = k
    ? [
        { label: "متاحة", value: k.availableVehicles, color: "var(--color-gold)" },
        { label: "محجوزة", value: k.bookedVehicles, color: "var(--color-navy)" },
        { label: "صيانة", value: k.maintenanceVehicles, color: "var(--color-amber)" },
      ]
    : [];
  const total = parts.reduce((s, p) => s + p.value, 0);
  const pct = k && k.totalVehicles ? Math.round((k.availableVehicles / k.totalVehicles) * 100) : 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <Panel title="حالة الأسطول" tag={<Link to="/fleet" className="hover:text-gold">إدارة الأسطول</Link>}>
      {loading || !k ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="flex items-center justify-between gap-4">
          <ul className="flex flex-col gap-3 text-[14px]">
            {parts.map((p) => (
              <li key={p.label} className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: p.color }} />
                <span className="text-muted">{p.label}</span>
                <b className="text-cream">{p.value}</b>
              </li>
            ))}
          </ul>
          <svg viewBox="0 0 140 140" className="size-36 shrink-0 -rotate-90" role="img" aria-label={`${pct}% من العربيات متاحة`}>
            <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-raised-2)" strokeWidth="14" />
            {total > 0 &&
              parts.map((p) => {
                const len = (p.value / total) * C;
                const el = (
                  <circle
                    key={p.label}
                    cx="70"
                    cy="70"
                    r={R}
                    fill="none"
                    stroke={p.color}
                    strokeWidth="14"
                    strokeDasharray={`${Math.max(0, len - 2)} ${C}`}
                    strokeDashoffset={-offset}
                    strokeLinecap="round"
                  />
                );
                offset += len;
                return el;
              })}
            <g className="rotate-90" style={{ transformOrigin: "70px 70px" }}>
              <circle cx="70" cy="70" r="36" fill="var(--color-surface)" />
              <text x="70" y="76" textAnchor="middle" className="fill-cream text-[22px] font-bold">
                {pct}%
              </text>
            </g>
          </svg>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- today
const SLOT_TONES = [
  "bg-linear-to-l from-gold to-gold-deep dark:to-gold text-on-accent",
  "bg-navy text-white",
  "bg-linear-to-l from-amber to-amber/80 text-white",
];

function TodayPanel() {
  const nav = useNavigate();
  const today = todayKey();
  const [day, setDay] = useState(today);
  const strip = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(today, i - 1)), [today]);
  const months = Array.from(new Set(strip.map((d) => d.slice(0, 7))));
  const counts: Record<string, number> = Object.assign(
    {},
    ...useQueries({ queries: months.map((m) => ({ queryKey: ["calendar", m], queryFn: () => api.get<Record<string, number>>(`/admin/bookings/calendar?month=${m}`) })) }).map((r) => r.data ?? {})
  );
  const q = useQuery({ queryKey: ["day", day], queryFn: () => api.get<DayDetails>(`/admin/days/${day}`) });
  const trips = (q.data?.bookings ?? []).filter((b) => b.status !== "CANCELLED").sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <Panel title={`${day === today ? "النهاردة" : weekdayFull(day)}، ${dayMonth(day)}`}>
      <div className="grid grid-cols-5 gap-1.5 border-b border-line pb-4">
        {strip.map((d) => {
          const c = counts[d] ?? 0;
          const on = d === day;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={cx("flex flex-col items-center gap-1 rounded-xl py-2 text-[14px] transition", on ? "bg-navy text-white shadow-[0_8px_18px_-10px_var(--color-navy)]" : "bg-raised text-cream hover:bg-raised-2")}
              aria-pressed={on}
              aria-label={`${weekdayFull(d)} ${dayMonth(d)}: ${c} حجز`}
            >
              <span className="font-bold ltr">{d.slice(8)}</span>
              <span className={cx("text-[12px]", on ? "opacity-80" : "text-muted")}>{weekdayShort(d)}</span>
              <span className="flex h-1.5 gap-0.5">
                {Array.from({ length: Math.min(3, c) }, (_, i) => (
                  <span key={i} className={cx("size-1.5 rounded-full", on ? "bg-white/90" : ["bg-gold", "bg-navy-soft", "bg-mint"][i])} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="pt-4">
        {q.isPending ? (
          <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
        ) : trips.length === 0 ? (
          <p className="py-6 text-center text-[14px] text-muted">مفيش رحلات في اليوم ده.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {trips.slice(0, 4).map((b, i) => (
              <li key={b.id} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-[13px] text-muted">{time12(b.startTime)}</span>
                <Link to={`/day/${day}?booking=${b.id}`} className={cx("lift flex min-w-0 flex-1 flex-col rounded-xl px-3 py-2.5", SLOT_TONES[i % SLOT_TONES.length])}>
                  <span className="truncate text-[14px] font-bold">{b.customer.name}</span>
                  <span className="truncate text-[12px] opacity-85">
                    {b.vehicle.name} · {b.driver.fullName}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => nav(`/day/${day}`)} className="mt-4 flex w-full items-center justify-center gap-1 text-[14px] font-bold text-gold hover:underline">
          {trips.length > 4 ? `كل الـ ${trips.length} رحلات` : "تفاصيل اليوم"} <ChevronLeft className="size-4" />
        </button>
      </div>
    </Panel>
  );
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
          <button type="button" className="flex size-7 items-center justify-center rounded-full border border-line text-cream hover:border-gold hover:text-gold" onClick={() => setPage((p) => p - 1)} aria-label="الأسبوعين اللي فاتوا">
            ›
          </button>
          <span>{monthYear(days[0])}</span>
          <button type="button" className="flex size-7 items-center justify-center rounded-full border border-line text-cream hover:border-gold hover:text-gold" onClick={() => setPage((p) => p + 1)} aria-label="الأسبوعين الجايين">
            ‹
          </button>
        </span>
      }
    >
      <div className="grid grid-cols-7 gap-1.5 sm:gap-1.5">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="pb-1 text-center text-[12px] text-muted">
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
                "relative flex aspect-square flex-col items-center justify-center rounded-xl text-[13px] transition hover:brightness-110",
                busy ? "bg-navy font-bold text-white shadow-[0_8px_18px_-10px_var(--color-navy)]" : c > 0 ? "border border-gold/50 bg-gold/12 font-bold text-gold" : "bg-raised text-muted",
                past && "opacity-55",
                d === today && "outline-2 outline-offset-2 outline-gold"
              )}
              aria-label={`${dayMonth(d)}: ${c} حجز`}
            >
              {loading ? <Skeleton className="h-3 w-4" /> : <span className="ltr">{Number(d.slice(8))}</span>}
              {c > 0 && <span className="text-[11px] font-normal">{c} حجز</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-3.5 flex items-center gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] border border-gold/50 bg-gold/12" />
          حجوزات متوسطة
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-navy" />
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

// ------------------------------------------------------------- drivers
const avatarTones = ["wine", "gold", "plain"] as const;

function DriversPanel() {
  const q = useQuery({ queryKey: ["drivers-summary", 3], queryFn: () => api.get<DriverSummary[]>("/admin/drivers-summary?limit=3") });
  return (
    <Panel title="أفضل السواقين" tag={<Link to="/drivers" className="hover:text-gold">الكل</Link>}>
      {q.error ? (
        <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.isPending ? (
        <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : (q.data ?? []).length === 0 ? (
        <Empty>لسه مفيش سائقين.</Empty>
      ) : (
        <ul className="flex flex-col">
          {q.data!.map((d, i) => (
            <li key={d.id}>
              <Link to={`/drivers/${d.id}`} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0 hover:text-gold">
                <Avatar text={initials(d.name)} tone={avatarTones[i % 3]} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-bold text-cream">{d.name}</span>
                  <span className="text-[13px] text-muted">
                    ⭐ {d.rating.toFixed(1)} · {num(d.monthTrips)} رحلة الشهر ده
                  </span>
                </span>
                <span className="text-[15px] font-bold text-cream ltr">{compact(d.monthRevenue)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
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
          <div className="truncate text-[15px] font-bold text-cream">{d.name}</div>
          <div className="text-[13px] text-muted">
            ⭐ {d.rating.toFixed(1)} · {st.label}
            {d.statusLocked && <span title="الحالة متحددة من الإدارة"> 🔒</span>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 border-b border-line pb-2.5 text-center">
        <div>
          <div className="text-[16px] font-bold text-gold">{num(d.totalTrips)}</div>
          <div className="text-[11px] text-muted">رحلة</div>
        </div>
        <div>
          <div className="text-[16px] font-bold text-cream">{num(d.monthTrips)}</div>
          <div className="text-[11px] text-muted">رحلات الشهر</div>
        </div>
        <div>
          <div className="text-[16px] font-bold text-rose ltr">{compact(d.monthRevenue)}</div>
          <div className="text-[11px] text-muted">إجمالي ج.م</div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-mint">
          تقييم العملاء له: {d.rating.toFixed(1)} ({d.reviewCount} تقييم)
        </span>
        <span className={d.complaints > 0 ? "text-rose" : "text-muted"}>شكاوى: {d.complaints}</span>
      </div>
    </Link>
  );
}
