import { useState, type FormEvent } from "react";
import { Coins, Percent, Route, Wallet } from "lucide-react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import type { DriverAnalytics as Data, Period } from "../lib/types";
import { DRIVER_STATUS } from "../lib/labels";
import { compact, dayMonth, egp, initials, num } from "../lib/format";
import { exportWorkbook } from "../lib/excel";
import { CHART_TAG, chartLabel, PERIOD_OPTIONS, PERIOD_WORD } from "../components/analytics";
import {
  Avatar,
  Badge,
  BarChart,
  Button,
  Chips,
  Empty,
  ErrorBox,
  KeyValue,
  Page,
  PageHeader,
  Panel,
  Skeleton,
  StatCard,
  StatGrid,
  Table,
  Td,
} from "../components/ui";

export default function DriverAnalytics() {
  const { id = "" } = useParams();
  const [period, setPeriod] = useState<Period>("day");
  const q = useQuery({ queryKey: ["driver-analytics", id, period], queryFn: () => api.get<Data>(`/admin/drivers/${id}/analytics?period=${period}`) });
  const d = q.data;
  const rate = d?.driver.commissionRate ?? 0;
  const word = PERIOD_WORD[period];

  const exportReport = () => {
    if (!d) return;
    exportWorkbook(`driver-${d.driver.name}-${period}.xlsx`, [
      {
        name: "ملخص",
        rows: [
          { البند: "السائق", القيمة: d.driver.name },
          { البند: "نسبة الشركة", القيمة: `${rate}%` },
          { البند: `رحلات ${word}`, القيمة: d.periodStats.trips },
          { البند: `دخل السائق ${word}`, القيمة: d.periodStats.driverIncome },
          { البند: `نسبة الشركة ${word}`, القيمة: d.periodStats.companyShare },
          { البند: `صافي السائق ${word}`, القيمة: d.periodStats.driverNet },
          { البند: "إجمالي الرحلات (كل الوقت)", القيمة: d.lifetime.trips },
          { البند: "دخل السائق الإجمالي", القيمة: d.lifetime.driverIncome },
          { البند: "إجمالي نسبة الشركة", القيمة: d.lifetime.companyShare },
          { البند: "متوسط قيمة الرحلة", القيمة: d.lifetime.averageTripValue },
          { البند: "تقييم العملاء", القيمة: d.quality.rating ?? "-" },
          { البند: "عدد الشكاوى", القيمة: d.quality.complaints },
          { البند: "الالتزام بالميعاد", القيمة: d.quality.punctualityRate != null ? `${d.quality.punctualityRate}%` : "-" },
        ],
      },
      { name: "الدخل", rows: d.chart.map((c) => ({ الفترة: c.key, الدخل: c.income, "نسبة الشركة": c.share })) },
      {
        name: "آخر الرحلات",
        rows: d.recentTrips.map((t) => ({ "رقم الحجز": t.ref, التاريخ: t.bookingDate, العميل: t.customer.name, "دخل الرحلة": t.value, "نسبة الشركة": t.share })),
      },
    ]);
  };

  return (
    <Page>
      <PageHeader
        back
        leading={d && <Avatar text={initials(d.driver.name)} />}
        eyebrow={<span className="normal-case tracking-[1px]">تحليلات السائق</span>}
        title={d?.driver.name ?? <Skeleton className="h-9 w-40" />}
        actions={d && <CommissionControl driverId={id} rate={rate} />}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips label="الفترة" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
        {d && (
          <Badge tone={DRIVER_STATUS[d.driver.status].tone} dot>
            {DRIVER_STATUS[d.driver.status].label}
          </Badge>
        )}
      </div>

      {q.error && <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />}

      <StatGrid>
        <StatCard icon={<Route />} loading={q.isPending} label={`رحلات ${word}`} value={d ? num(d.periodStats.trips) : ""} />
        <StatCard icon={<Wallet />} loading={q.isPending} label={`دخل السائق ${word}`} tone="cream" value={d ? num(d.periodStats.driverIncome) : ""} delta="ج.م" />
        <StatCard icon={<Percent />} loading={q.isPending} label={`نسبتك (${rate}%)`} value={d ? num(d.periodStats.companyShare) : ""} delta="ج.م" />
        <StatCard icon={<Coins />} loading={q.isPending} label="صافي السائق بعد النسبة" tone="rose" value={d ? num(d.periodStats.driverNet) : ""} delta={`ج.م ${word}`} />
      </StatGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="الدخل مقابل نسبتك" tag={CHART_TAG[period]}>
            {!d ? (
              <Skeleton className="h-[140px]" />
            ) : (
              <>
                <BarChart
                  overlay
                  format={compact}
                  data={d.chart.map((c) => ({ label: chartLabel(period, c.key), value: c.income, overlay: c.share, title: `الدخل ${egp(c.income)} · نسبتك ${egp(c.share)}` }))}
                />
                <div className="mt-3 flex gap-4 text-[12px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-[2px] bg-gold" />
                    دخل السائق
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-[2px] bg-wine" />
                    نسبتك
                  </span>
                </div>
              </>
            )}
          </Panel>
          <Panel title="سجل الرحلات" tag="آخر 5 رحلات">
            {!d ? (
              <Skeleton className="h-40" />
            ) : d.recentTrips.length === 0 ? (
              <Empty>لسه مفيش رحلات.</Empty>
            ) : (
              <Table head={["التاريخ", "العميل", "دخل الرحلة", "نسبتك"]}>
                {d.recentTrips.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <Link to={`/day/${t.bookingDate}?booking=${t.id}`} className="hover:text-gold">
                        {dayMonth(t.bookingDate)}
                      </Link>
                    </Td>
                    <Td>
                      <Link to={`/customers/${t.customer.id}`} className="hover:text-gold">
                        {t.customer.name}
                      </Link>
                    </Td>
                    <Td>{egp(t.value)}</Td>
                    <Td className="text-gold">{egp(t.share)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="ملخص شامل">
            {!d ? (
              <Skeleton className="h-40" />
            ) : (
              <>
                <KeyValue label="إجمالي الرحلات (كل الوقت)" value={num(d.lifetime.trips)} tone="gold" />
                <KeyValue label="دخل السائق الإجمالي" value={`${compact(d.lifetime.driverIncome)} ج.م`} />
                <KeyValue label="إجمالي أرباحك منه" value={`${compact(d.lifetime.companyShare)} ج.م`} tone="rose" />
                <KeyValue label="متوسط قيمة الرحلة" value={egp(d.lifetime.averageTripValue)} />
              </>
            )}
          </Panel>
          <Panel title="جودة الأداء">
            {!d ? (
              <Skeleton className="h-28" />
            ) : (
              <>
                <KeyValue
                  label="تقييم العملاء له"
                  value={d.quality.rating != null ? `${d.quality.rating.toFixed(1)} ★ (${d.quality.reviewCount})` : "لسه مفيش تقييمات"}
                  tone={d.quality.rating != null && d.quality.rating < 4 ? "gold" : "mint"}
                />
                <KeyValue label="عدد الشكاوى" value={num(d.quality.complaints)} tone={d.quality.complaints > 0 ? "rose" : "mint"} />
                <KeyValue
                  label="معدل الالتزام بالميعاد"
                  value={d.quality.punctualityRate != null ? `${d.quality.punctualityRate}%` : "—"}
                  tone={d.quality.punctualityRate != null && d.quality.punctualityRate < 85 ? "gold" : "mint"}
                />
              </>
            )}
          </Panel>
          <Button onClick={exportReport} disabled={!d} className="w-full py-3">
            تصدير التقرير Excel
          </Button>
        </div>
      </div>
    </Page>
  );
}

function CommissionControl({ driverId, rate }: { driverId: string; rate: number }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(rate));
  const save = useMutation({
    mutationFn: () => api.patch(`/admin/drivers/${driverId}/commission`, { commissionRate: Number(value) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["driver-analytics", driverId] });
      qc.invalidateQueries({ queryKey: ["audit"] });
      setEditing(false);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const valid = value !== "" && Number(value) >= 0 && Number(value) <= 100;

  if (!editing) {
    return (
      <>
        <span className="rounded-full border border-gold bg-gold/15 px-3 py-1.5 text-[13px] text-gold">نسبتك {rate}%</span>
        <Button size="sm" onClick={() => { setValue(String(rate)); setEditing(true); }}>
          تعديل النسبة
        </Button>
      </>
    );
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <label className="flex items-center gap-1 rounded-[9px] border border-gold/60 bg-raised px-2 py-1">
        <input
          autoFocus
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="ltr w-14 bg-transparent text-center text-[14px] font-bold text-cream outline-none"
          aria-label="نسبة الشركة بالمية"
        />
        <span className="text-[13px] text-muted">%</span>
      </label>
      <Button size="sm" variant="primary" type="submit" disabled={!valid || save.isPending}>
        {save.isPending ? "…" : "حفظ"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        إلغاء
      </Button>
      {save.error && <span className="text-[13px] text-rose">{errorMessage(save.error)}</span>}
    </form>
  );
}
