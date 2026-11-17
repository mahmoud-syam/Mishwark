import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import type { LiveTrip } from "../lib/types";
import { minutesLabel, telHref, whatsappHref } from "../lib/format";
import { cx, Empty, ErrorBox, Page, PageHeader, ProgressBar, Skeleton } from "../components/ui";

const tripsCount = (n: number) => (n === 0 ? "مفيش رحلات شغالة" : n === 1 ? "رحلة واحدة شغالة دلوقتي" : n === 2 ? "رحلتين شغالين دلوقتي" : `${n} رحلات شغالة دلوقتي`);

export default function LiveOps() {
  const q = useQuery({
    queryKey: ["live-trips"],
    queryFn: () => api.get<LiveTrip[]>("/admin/trips/live"),
    refetchInterval: 30_000,
  });
  const trips = q.data ?? [];

  return (
    <Page>
      <PageHeader
        back="/"
        eyebrow="Super Admin"
        title="الرحلات الجارية الآن"
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-mint bg-mint/15 px-3 py-1.5 text-[11px] text-mint">
            <span className={cx("size-1.5 rounded-full bg-mint", trips.length > 0 && "pulse-dot")} />
            {tripsCount(trips.length)}
          </span>
        }
      />

      {q.error && <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />}

      {q.isPending ? (
        <div className="flex flex-col gap-4">{[0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-[18px]" />)}</div>
      ) : trips.length === 0 ? (
        <Empty>مفيش رحلات شغالة دلوقتي. أول ما سائق يبدأ رحلة هتظهر هنا تلقائيًا.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {trips.map((t, i) => (
            <TripCard key={t.id} t={t} featured={i === 0 && !t.isDelayed} />
          ))}
        </div>
      )}
      <p className="text-center text-[10px] text-muted">بتتحدث تلقائيًا كل 30 ثانية</p>
    </Page>
  );
}

function TripCard({ t, featured }: { t: LiveTrip; featured: boolean }) {
  return (
    <article
      className={cx(
        "flex flex-col gap-3 rounded-[18px] border bg-surface p-5",
        t.isDelayed ? "border-wine bg-wine/8" : featured ? "border-gold" : "border-line"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-bold text-cream">
          <span className={cx("size-1.5 rounded-full", t.isDelayed ? "bg-rose" : "bg-mint")} />
          {t.customer.name} — {t.vehicle.name}
          {t.tripStatus === "ARRIVED" && <span className="text-[10px] font-normal text-gold">(وصل للوجهة)</span>}
        </h2>
        {t.isDelayed ? (
          <span className="text-[11px] text-rose">⚠️ متأخرة {minutesLabel(t.delayMinutes)} عن الميعاد المتوقع</span>
        ) : (
          <span className="text-[11px] text-muted">
            بدأت من {minutesLabel(t.elapsedMinutes)}
            {!t.startedOnRecord && " (حسب الميعاد)"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="min-w-0">
          <div className="text-[10px] text-muted">خط السير</div>
          <div className="truncate text-[12px] text-cream">
            {t.startPoint} ← {t.endPoint}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted">السائق</div>
          <Link to={`/drivers/${t.driver.id}`} className="text-[12px] text-cream hover:text-gold">
            {t.driver.name}
          </Link>
        </div>
        <div>
          <div className="text-[10px] text-muted">الوقت المتبقي</div>
          <div className={cx("text-[12px] font-bold", t.isDelayed ? "text-rose" : "text-gold")}>
            {t.tripStatus === "ARRIVED" ? "وصل" : `≈ ${minutesLabel(t.remainingMinutes)}`}
          </div>
        </div>
      </div>

      <ProgressBar value={t.tripStatus === "ARRIVED" ? 1 : t.progress} tone={t.isDelayed ? "rose" : "gold"} />

      <div className="grid grid-cols-2 gap-2.5">
        {t.isDelayed ? (
          <a
            href={telHref(t.driver.phone)}
            className={cx("rounded-xl border border-wine bg-wine/20 py-2.5 text-center text-[11px] font-bold text-blush transition hover:bg-wine/30", !t.driver.phone && "pointer-events-none opacity-50")}
          >
            📞 اتصال فوري بالسائق
          </a>
        ) : (
          <a
            href={whatsappHref(t.driver.phone)}
            target="_blank"
            rel="noreferrer"
            className={cx("rounded-xl border border-line bg-raised py-2.5 text-center text-[11px] font-bold text-cream transition hover:border-gold/60", !t.driver.phone && "pointer-events-none opacity-50")}
          >
            💬 تواصل مع السائق
          </a>
        )}
        <Link
          to={`/day/${t.bookingDate}?booking=${t.id}`}
          className="rounded-xl border border-line bg-raised py-2.5 text-center text-[11px] font-bold text-cream transition hover:border-gold/60"
        >
          عرض التفاصيل الكاملة
        </Link>
      </div>
    </article>
  );
}
