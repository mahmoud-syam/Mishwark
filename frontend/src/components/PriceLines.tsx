import type { PriceLine, ServiceType } from "../lib/types";
import { egp, num } from "../lib/format";
import { cx } from "./ui";

export const SERVICE_LABEL: Record<ServiceType, string> = { WEDDING: "زفاف", TRIP: "مشوار خاص", VIP: "VIP" };

const hours = (n: number) => (n === 1 ? "ساعة" : n === 2 ? "ساعتين" : `${num(n)} ساعات`);

/** One line of the price in plain words: what it is, how it was worked out, the amount. */
function describe(l: PriceLine): { title: string; detail?: string } {
  const covers = [l.includedHours != null ? hours(l.includedHours) : null, l.includedKm != null ? `${num(l.includedKm)} كم` : null].filter(Boolean).join(" و");
  switch (l.code) {
    case "wedding":
      return { title: "سعر الزفاف للعربية دي", detail: covers ? `بيشمل ${covers}` : undefined };
    case "vip":
      return { title: "سعر مناسبة VIP للعربية دي", detail: covers ? `بيشمل ${covers}` : undefined };
    case "trip":
      return { title: `مشوار لـ ${l.name ?? "الوجهة"}`, detail: covers ? `سعر ثابت بيشمل ${covers}` : undefined };
    case "trip_other":
      return { title: "مشوار لمكان مش في قايمة الوجهات", detail: covers ? `سعر نوع العربية، بيشمل ${covers}` : undefined };
    case "extra_hours":
      return { title: "ساعات زيادة", detail: `${hours(l.quantity ?? 0)} × ${egp(l.unitPrice)} (بعد أول ${hours(l.included ?? 0)})` };
    case "extra_km":
      return { title: "كيلومترات زيادة", detail: `${num(l.quantity)} كم × ${egp(l.unitPrice)} (بعد أول ${num(l.included)} كم)` };
    case "package_discount":
      return { title: "خصم الباكدج" };
    case "referral_discount":
      return { title: "خصم أول حجز (إحالة)" };
  }
}

/**
 * The price as the customer will be told it: the base price with what it
 * covers, any extra hours / km with the sum, discounts, then the total and the
 * deposit. Distance and booked time underneath so the numbers can be checked.
 */
export default function PriceLines({
  lines,
  total,
  deposit,
  depositRate,
  distanceKm,
  distanceEstimated,
  bookedMinutes,
}: {
  lines: PriceLine[];
  total: number;
  deposit: number;
  depositRate?: number;
  distanceKm?: number;
  distanceEstimated?: boolean;
  bookedMinutes?: number | null;
}) {
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {lines.map((l, i) => {
          const d = describe(l);
          return (
            <li key={`${l.code}-${i}`} className="flex items-start justify-between gap-3 border-b border-line py-2.5">
              <div className="min-w-0">
                <div className="text-[14px] font-bold text-cream">{d.title}</div>
                {d.detail && <div className="text-[12px] text-muted">{d.detail}</div>}
              </div>
              <div className={cx("ltr shrink-0 text-[15px] font-bold", l.amount < 0 ? "text-mint" : "text-cream")}>
                {l.amount < 0 ? `− ${egp(-l.amount)}` : egp(l.amount)}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 py-3">
        <span className="text-[15px] font-bold text-cream">الإجمالي</span>
        <span className="ltr text-[20px] font-bold text-gold">{egp(total)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-raised px-3 py-2 text-[13px]">
        <span className="text-muted">العربون المطلوب لتأكيد الحجز{depositRate != null ? ` (${num(depositRate)}%)` : ""}</span>
        <span className="ltr font-bold text-cream">{egp(deposit)}</span>
      </div>
      {(distanceKm != null || bookedMinutes != null) && (
        <p className="mt-2 text-[12px] text-muted">
          {distanceKm != null && (
            <>
              المسافة {num(Math.round(distanceKm * 10) / 10)} كم{distanceEstimated ? " (تقديرية بخط مستقيم، مش الطريق الفعلي)" : " على الطريق"}
            </>
          )}
          {distanceKm != null && bookedMinutes != null && " · "}
          {bookedMinutes != null && <>مدة الحجز {hours(Math.floor(bookedMinutes / 60))}{bookedMinutes % 60 ? ` و${bookedMinutes % 60} دقيقة` : ""}</>}
        </p>
      )}
    </div>
  );
}
