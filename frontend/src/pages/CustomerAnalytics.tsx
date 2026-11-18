import { useState } from "react";
import { CalendarCheck, Coins, Crown, UserRound, Wallet } from "lucide-react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import type { CustomerAnalytics as Data, Period } from "../lib/types";
import { BOOKING_STATUS } from "../lib/labels";
import { compact, dateKeyOf, dayMonth, egp, initials, maskPhone, monthYear, num, telHref } from "../lib/format";
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
  LinkButton,
  Page,
  PageHeader,
  Panel,
  Skeleton,
  StatCard,
  StatGrid,
  Table,
  Td,
} from "../components/ui";

export default function CustomerAnalytics() {
  const { id = "" } = useParams();
  const [period, setPeriod] = useState<Period>("day");
  const q = useQuery({ queryKey: ["customer-analytics", id, period], queryFn: () => api.get<Data>(`/admin/customers/${id}/analytics?period=${period}`) });
  const d = q.data;
  const word = PERIOD_WORD[period];

  const exportReport = () => {
    if (!d) return;
    exportWorkbook(`customer-${d.customer.name}-${period}.xlsx`, [
      {
        name: "ملخص",
        rows: [
          { البند: "العميل", القيمة: d.customer.name },
          { البند: "الموبايل", القيمة: d.customer.phoneNumber ?? "-" },
          { البند: "عضو منذ", القيمة: dateKeyOf(new Date(d.customer.memberSince)) },
          { البند: "عميل VIP", القيمة: d.customer.isVip ? "نعم" : "لا" },
          { البند: `حجوزات ${word}`, القيمة: d.periodStats.bookings },
          { البند: `إنفاقه ${word}`, القيمة: d.periodStats.spend },
          { البند: "إجمالي إنفاقه", القيمة: d.lifetime.spend },
          { البند: "إجمالي عدد الحجوزات", القيمة: d.lifetime.bookings },
          { البند: "متوسط قيمة الحجز", القيمة: d.lifetime.averageBookingValue },
          { البند: "حجوزات ملغاة", القيمة: d.lifetime.cancelled },
          { البند: "رصيد المحفظة", القيمة: d.lifetime.walletBalance },
          { البند: "أصدقاء دعاهم", القيمة: d.referrals.invited },
          { البند: "حجزوا فعليًا", القيمة: d.referrals.converted },
        ],
      },
      { name: "الإنفاق", rows: d.chart.map((c) => ({ الفترة: c.key, الإنفاق: c.spend })) },
      { name: "آخر الحجوزات", rows: d.recentBookings.map((b) => ({ "رقم الحجز": b.ref, التاريخ: b.bookingDate, العربية: b.vehicle, القيمة: b.value, الحالة: BOOKING_STATUS[b.status].label })) },
    ]);
  };

  return (
    <Page>
      <PageHeader
        back
        leading={d && <Avatar text={initials(d.customer.name)} tone="gold" />}
        eyebrow={<span className="normal-case tracking-[1px]">تحليلات العميل</span>}
        title={d?.customer.name ?? <Skeleton className="h-9 w-40" />}
        actions={
          d && (
            <>
              {d.customer.isVip && <Badge tone="mint" className="px-3 py-1.5 text-[13px]"><Crown className="size-3.5" /> عميل VIP</Badge>}
              {d.customer.phoneNumber && (
                <a href={telHref(d.customer.phoneNumber)} className="ltr rounded-full border border-line bg-raised px-3 py-1.5 text-[13px] text-muted hover:text-cream">
                  {maskPhone(d.customer.phoneNumber)}
                </a>
              )}
              <LinkButton to={`/book?customer=${d.customer.id}`} variant="primary">+ حجز جديد ليه</LinkButton>
            </>
          )
        }
      />

      <Chips label="الفترة" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />

      {q.error && <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />}

      <StatGrid>
        <StatCard icon={<CalendarCheck />} loading={q.isPending} label={`حجوزات ${word}`} value={d ? num(d.periodStats.bookings) : ""} />
        <StatCard icon={<Wallet />} loading={q.isPending} label={`إنفاقه ${word}`} tone="cream" value={d ? num(d.periodStats.spend) : ""} delta="ج.م" />
        <StatCard icon={<Coins />} loading={q.isPending} label="إجمالي إنفاقه (كل الوقت)" tone="rose" value={d ? compact(d.lifetime.spend) : ""} delta="ج.م" />
        <StatCard icon={<UserRound />} loading={q.isPending} label="عضو منذ" value={d ? monthYear(dateKeyOf(new Date(d.customer.memberSince))) : ""} />
      </StatGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="إنفاق العميل" tag={CHART_TAG[period]}>
            {!d ? (
              <Skeleton className="h-[140px]" />
            ) : (
              <BarChart format={compact} data={d.chart.map((c) => ({ label: chartLabel(period, c.key), value: c.spend, title: egp(c.spend) }))} />
            )}
          </Panel>
          <Panel title="سجل حجوزاته" tag="آخر 5 حجوزات">
            {!d ? (
              <Skeleton className="h-40" />
            ) : d.recentBookings.length === 0 ? (
              <Empty>العميل ده لسه معملش حجوزات.</Empty>
            ) : (
              <Table head={["التاريخ", "العربية", "القيمة", "الحالة"]}>
                {d.recentBookings.map((b) => (
                  <tr key={b.id}>
                    <Td>
                      <Link to={`/day/${b.bookingDate}?booking=${b.id}`} className="hover:text-gold">
                        {dayMonth(b.bookingDate)}
                      </Link>
                    </Td>
                    <Td>{b.vehicle}</Td>
                    <Td>{egp(b.value)}</Td>
                    <Td>
                      <Badge tone={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="ملخص العميل">
            {!d ? (
              <Skeleton className="h-40" />
            ) : (
              <>
                <KeyValue label="إجمالي عدد الحجوزات" value={num(d.lifetime.bookings)} tone="gold" />
                <KeyValue label="متوسط قيمة الحجز" value={egp(d.lifetime.averageBookingValue)} />
                <KeyValue label="حجوزات ملغاة" value={num(d.lifetime.cancelled)} tone={d.lifetime.cancelled > 0 ? "rose" : "muted"} />
                <KeyValue label="رصيد المحفظة الحالي" value={egp(d.lifetime.walletBalance)} tone="mint" />
              </>
            )}
          </Panel>
          <Panel title="إحالات العميل">
            {!d ? (
              <Skeleton className="h-20" />
            ) : (
              <>
                <KeyValue label="أصدقاء دعاهم" value={num(d.referrals.invited)} tone="gold" />
                <KeyValue label="حجزوا فعليًا" value={num(d.referrals.converted)} />
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
