import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dayMonth, egp, todayKey } from "../lib/format";
import { FLEET_STATUS, VEHICLE_CATEGORY } from "../lib/labels";
import type { FleetItem, FleetStatus, FleetSummary } from "../lib/types";
import { Badge, Chips, cx, Empty, ErrorBox, fieldControl, LinkButton, Page, PageHeader, Skeleton, StatCard, StatGrid } from "../components/ui";

type Filter = "ALL" | FleetStatus;

const CATEGORY_ICON: Record<string, string> = { CAR: "🚗", VAN: "🚐", BUS: "🚌", TRUCK: "🚚", CLASSIC: "🚘", LUXURY: "🚙" };

export const canManageFleet = (me: ReturnType<typeof useAuth>["me"]) =>
  me?.role?.name === "SUPER_ADMIN" || !!me?.role?.permissions?.includes("vehicle:manage");

function CarCard({ v }: { v: FleetItem }) {
  const st = FLEET_STATUS[v.status];
  const primary = v.drivers.find((d) => d.isPrimary) ?? v.drivers[0];
  const m = v.nextMaintenance;
  const today = todayKey();
  return (
    <Link
      to={`/fleet/${v.id}`}
      className={cx("lift group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-gold/50", v.status === "RETIRED" && "opacity-60")}
    >
      <div className="relative h-36 bg-raised">
        {v.coverImage ? (
          <img src={v.coverImage} alt={v.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-[42px]" aria-hidden>
            {CATEGORY_ICON[v.category] ?? "🚗"}
          </div>
        )}
        <span className="absolute right-3 top-3">
          <Badge tone={st.tone} dot>
            {st.label}
          </Badge>
        </span>
        {v.imagesCount > 0 && <span className="absolute bottom-2 left-3 rounded-full bg-ink/70 px-2 py-0.5 text-[10px] text-cream">📷 {v.imagesCount}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-bold text-cream">{v.name}</div>
            <div className="text-[11px] text-muted">
              {VEHICLE_CATEGORY[v.category] ?? v.category} · {v.year} · {v.capacity} راكب{v.luggage ? ` · ${v.luggage} شنط` : ""}
            </div>
          </div>
          <span className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] text-cream">{v.plateNumber.replace(/·D$/, "")}</span>
        </div>
        <div className="text-[12px] text-gold">يبدأ من {egp(v.effectiveBasePrice)}</div>
        <div className="mt-auto flex flex-col gap-1 border-t border-line pt-2 text-[11px]">
          {v.status !== "RETIRED" &&
            (primary ? (
              <span className="text-muted">
                السواق: <span className="text-cream">{primary.name}</span>
                {v.drivers.length > 1 && ` +${v.drivers.length - 1}`}
                {v.drivers.every((d) => d.status === "ONLEAVE" || d.status === "OFF") && (
                  <span className="block text-rose">⚠ {v.drivers.length > 1 ? "كل سواقينها" : "سواقها"} في إجازة أو خارج الخدمة · مش هتتحجز</span>
                )}
              </span>
            ) : (
              <span className="text-rose">⚠ من غير سواق · مش ظاهرة للعملاء</span>
            ))}
          {m && v.status !== "RETIRED" && (
            <span className="text-muted">
              🔧 {m.type}: {m.startDate <= today ? "دلوقتي" : dayMonth(m.startDate)}
              {m.endDate !== m.startDate && ` → ${dayMonth(m.endDate)}`}
            </span>
          )}
          {v.upcomingBookings > 0 && <span className="text-muted">📅 {v.upcomingBookings} حجز جاي</span>}
        </div>
      </div>
    </Link>
  );
}

export default function Fleet() {
  const { me } = useAuth();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  const q = useQuery({
    queryKey: ["fleet-list", category],
    queryFn: () => api.raw<{ data: FleetItem[]; summary: FleetSummary }>("GET", `/admin/vehicles${category ? `?category=${category}` : ""}`),
  });
  const s = q.data?.summary;
  const term = search.trim().toLowerCase();
  const items = (q.data?.data ?? [])
    .filter((v) => (filter === "ALL" ? v.status !== "RETIRED" : v.status === filter))
    .filter((v) => !term || `${v.name} ${v.plateNumber}`.toLowerCase().includes(term));

  return (
    <Page>
      <PageHeader
        back="/"
        eyebrow="Super Admin"
        title="الأسطول"
        actions={canManageFleet(me) && <LinkButton to="/fleet/new" variant="primary">+ إضافة عربية</LinkButton>}
      />
      {q.error && <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />}

      <StatGrid>
        <StatCard label="عربيات شغّالة" value={s ? String(s.total) : ""} loading={!s} delta={s ? `${s.retired} موقوفة` : ""} />
        <StatCard label="متاحة النهارده" value={s ? String(s.available) : ""} loading={!s} tone="mint" />
        <StatCard label="محجوزة النهارده" value={s ? String(s.booked) : ""} loading={!s} />
        <StatCard label="في الصيانة" value={s ? String(s.maintenance) : ""} loading={!s} tone="rose" />
      </StatGrid>

      {s && s.withoutDriver > 0 && (
        <div className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[12px] text-cream">
          ⚠ {s.withoutDriver === 1 ? "عربية واحدة" : `${s.withoutDriver} عربيات`} من غير سواق: مش هتظهر للعملاء ولا تتحجز لحد ما تحدد لها سواق.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Chips
          label="حالة العربية"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "ALL", label: "الكل" },
            { value: "AVAILABLE", label: "متاحة" },
            { value: "BOOKED", label: "محجوزة" },
            { value: "MAINTENANCE", label: "صيانة" },
            { value: "RETIRED", label: "موقوفة" },
          ]}
        />
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <select
            className="rounded-xl border border-line bg-raised px-3 py-2 text-[12px] text-cream outline-none focus:border-gold/60"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="نوع العربية"
          >
            <option value="">كل الأنواع</option>
            {Object.entries(VEHICLE_CATEGORY).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <input
            className={cx(fieldControl, "w-56 rounded-xl border border-line bg-raised px-3 py-2 text-[12px] font-normal")}
            placeholder="دور بالاسم أو رقم اللوحة"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="بحث في الأسطول"
          />
        </div>
      </div>

      {q.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}</div>
      ) : items.length === 0 ? (
        <Empty>{term || filter !== "ALL" || category ? "مفيش عربيات بالمواصفات دي." : "لسه مفيش عربيات. ابدأ بـ «إضافة عربية»."}</Empty>
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((v) => (
            <CarCard key={v.id} v={v} />
          ))}
        </div>
      )}
    </Page>
  );
}
