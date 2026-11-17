import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import type { DayDetails as DayData } from "../lib/types";
import { BOOKING_STATUS } from "../lib/labels";
import { addDays, compact, fullDate, time12, todayKey, weekdayFull } from "../lib/format";
import { Badge, cx, Empty, ErrorBox, Page, PageHeader, Panel, Skeleton, StatCard, StatGrid } from "../components/ui";
import PaymentDialog from "../components/PaymentDialog";

const PAY_BADGE = {
  PAID: { label: "مدفوع", tone: "mint" as const },
  PARTIALLY_PAID: { label: "مدفوع جزئي", tone: "gold" as const },
  UNPAID: { label: "مش مدفوع", tone: "rose" as const },
};

const tripsLabel = (n: number) => (n === 1 ? "رحلة واحدة" : n === 2 ? "رحلتين" : `${n} رحلات`);

export default function DayDetails() {
  const { date = todayKey() } = useParams();
  const [params] = useSearchParams();
  const highlight = params.get("booking");
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["day", date], queryFn: () => api.get<DayData>(`/admin/days/${date}`) });
  const s = q.data?.stats;
  const [paying, setPaying] = useState<string | null>(null);
  const payingBooking = q.data?.bookings.find((b) => b.id === paying);

  useEffect(() => {
    if (highlight && q.data) document.getElementById(`b-${highlight}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight, q.data]);

  return (
    <Page width="narrow">
      <PageHeader
        back="/"
        eyebrow={
          <span className="flex items-center gap-2 normal-case tracking-[1px]">
            <button type="button" onClick={() => nav(`/day/${addDays(date, -1)}`)} className="hover:text-cream" aria-label="اليوم اللي قبله">
              ›
            </button>
            <span>
              {fullDate(date)} · {weekdayFull(date)}
            </span>
            <button type="button" onClick={() => nav(`/day/${addDays(date, 1)}`)} className="hover:text-cream" aria-label="اليوم اللي بعده">
              ‹
            </button>
          </span>
        }
        title={date === todayKey() ? "حجوزات اليوم" : "حجوزات اليوم ده"}
      />

      {q.error && <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />}

      <StatGrid>
        <StatCard loading={q.isPending} label="إجمالي حجوزات اليوم" value={s?.total ?? ""} />
        <StatCard loading={q.isPending} label="عربيات مستخدمة" tone="cream" value={s ? `${s.vehiclesUsed} / ${s.totalVehicles}` : ""} />
        <StatCard loading={q.isPending} label="إيراد اليوم المتوقع" tone="rose" value={s ? compact(s.expectedRevenue) : ""} />
        <StatCard loading={q.isPending} label="حجوزات معلّقة" value={s?.pending ?? ""} />
      </StatGrid>

      <Panel title="جدول اليوم بالتوقيت" tag={s ? `${s.total} حجوزات` : undefined}>
        {q.isPending ? (
          <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !q.data || q.data.bookings.length === 0 ? (
          <Empty>مفيش حجوزات في اليوم ده.</Empty>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {q.data.bookings.map((b) => {
              const st = BOOKING_STATUS[b.status];
              const active = b.id === highlight;
              return (
                <li
                  key={b.id}
                  id={`b-${b.id}`}
                  className={cx("flex items-start gap-4 rounded-xl border-b border-line px-2 py-3 last:border-b-0", active && "border-transparent bg-gold/12")}
                >
                  <span className={cx("w-14 shrink-0 pt-0.5 text-[13px] font-bold", active ? "text-gold" : "text-gold/90")}>{time12(b.startTime)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold text-cream">
                      <Link to={`/customers/${b.customer.id}`} className="hover:text-gold">
                        {b.customer.name}
                      </Link>{" "}
                      — {b.vehicle.name}
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">
                      {b.startPoint} ← {b.endPoint}
                      {b.eventType && <span> · {b.eventType}</span>}
                      {b.packageId && <span> · جزء من باقة</span>}
                    </div>
                    <div className="mt-1 text-[12px] text-gold/90">
                      🚗 السائق:{" "}
                      <Link to={`/drivers/${b.driver.id}`} className="hover:text-gold">
                        {b.driver.fullName}
                      </Link>
                      <span className="text-muted"> · <span className="ltr">#{b.ref}</span></span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge tone={b.tripStatus === "INPROGRESS" || b.tripStatus === "ARRIVED" ? "gold" : st.tone}>
                      {b.tripStatus === "INPROGRESS" ? "في الطريق" : b.tripStatus === "ARRIVED" ? "وصل" : st.label}
                    </Badge>
                    {b.status !== "CANCELLED" && (
                      <button
                        type="button"
                        onClick={() => setPaying(b.id)}
                        className="flex items-center gap-1 rounded-full transition hover:brightness-125"
                        title="الدفع"
                      >
                        <Badge tone={PAY_BADGE[b.paymentStatus].tone}>
                          💳 {PAY_BADGE[b.paymentStatus].label}
                          {b.payments.some((p) => p.status === "PENDING") && <span className="pulse-dot">•</span>}
                        </Badge>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {payingBooking && <PaymentDialog key={payingBooking.id} booking={payingBooking} onClose={() => setPaying(null)} />}

      <Panel title="السائقون المكلّفون اليوم">
        {q.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <ul>
            {(q.data?.drivers ?? [])
              .slice()
              .sort((a, b) => b.trips.length - a.trips.length)
              .map((d) => {
                const assigned = d.trips.length > 0;
                const unavailable = d.status === "ONLEAVE" || d.status === "OFF";
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
                    <Link to={`/drivers/${d.id}`} className="min-w-0 hover:text-gold">
                      <div className="text-[15px] font-bold text-cream">{d.name}</div>
                      <div className="text-[13px] text-muted">
                        {assigned ? `${tripsLabel(d.trips.length)} · ${d.trips.map(time12).join(" و ")}` : unavailable ? "مش متاح اليوم" : "غير مكلّف اليوم"}
                      </div>
                    </Link>
                    <Badge tone={assigned ? "mint" : "muted"} dot>
                      {assigned ? "مكلّف" : unavailable ? (d.status === "ONLEAVE" ? "إجازة" : "خارج الخدمة") : "متاح للتكليف"}
                    </Badge>
                  </li>
                );
              })}
          </ul>
        )}
      </Panel>
    </Page>
  );
}
