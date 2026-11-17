import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight, CreditCard, Search, X } from "lucide-react";
import { api, ApiError, errorMessage } from "../lib/api";
import type { BookingRow, BookingSearch, BookingStatus, CancellationTerms } from "../lib/types";
import { BOOKING_STATUS } from "../lib/labels";
import { dayMonth, egp, monthName, num, relativeStamp, timeRange, todayKey, weekdayShort } from "../lib/format";
import { Badge, Button, Chips, cx, Empty, ErrorBox, LinkButton, Page, PageHeader, Skeleton, Toggle } from "../components/ui";
import PaymentDialog from "../components/PaymentDialog";

const PAY = {
  PAID: { label: "مدفوع", tone: "mint" as const },
  PARTIALLY_PAID: { label: "مدفوع جزئي", tone: "gold" as const },
  UNPAID: { label: "مش مدفوع", tone: "rose" as const },
};

const SCOPES = [
  { value: "upcoming", label: "الجاية" },
  { value: "past", label: "اللي فاتت" },
  { value: "all", label: "الكل" },
] as const;
type Scope = (typeof SCOPES)[number]["value"];

const STATUSES: { value: "" | BookingStatus; label: string }[] = [
  { value: "", label: "كل الحالات" },
  { value: "PENDING", label: BOOKING_STATUS.PENDING.label },
  { value: "CONFIRMED", label: BOOKING_STATUS.CONFIRMED.label },
  { value: "COMPLETED", label: BOOKING_STATUS.COMPLETED.label },
  { value: "CANCELLED", label: BOOKING_STATUS.CANCELLED.label },
];

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Every booking in one place: search by reference, name or phone, filter by
 * status and payment, then open one to confirm it, record a payment or cancel
 * it (the deposit is settled by the cancellation policy, or as the admin decides).
 */
export default function Bookings() {
  const [params, setParams] = useSearchParams();
  const scope = (params.get("scope") as Scope) || "upcoming";
  const status = (params.get("status") as BookingStatus | null) ?? "";
  const payment = params.get("payment") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [text, setText] = useState(params.get("q") ?? "");
  const q = useDebounced(text.trim());
  const [openId, setOpenId] = useState<string | null>(params.get("booking"));

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if ((params.get("q") ?? "") !== q) set({ q });
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const qs = new URLSearchParams({ scope, page: String(page), limit: "25", ...(q && { q }), ...(status && { status }), ...(payment && { paymentStatus: payment }) });
  const list = useQuery({
    queryKey: ["bookings", qs.toString()],
    queryFn: () => api.raw<{ data: BookingRow[]; counts: BookingSearch["counts"]; pagination: BookingSearch["pagination"] }>("GET", `/admin/bookings/search?${qs}`),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.data ?? [];
  const counts = list.data?.counts;
  const pg = list.data?.pagination;
  const allCount = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;
  const open = rows.find((b) => b.id === openId) ?? null;

  return (
    <Page>
      <PageHeader
        eyebrow="كل الحجوزات"
        title="الحجوزات"
        actions={
          <LinkButton to="/book" variant="primary">
            <CalendarPlus className="size-4" /> احجز لعميل
          </LinkButton>
        }
      />

      <section className="card flex flex-col gap-4 p-[18px]">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2.5 focus-within:border-gold/60">
            <Search className="size-4 text-muted" aria-hidden />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="ابحث برقم الحجز (MW-…) أو اسم العميل أو رقم الموبايل"
              className="w-full bg-transparent text-[14px] text-cream outline-none placeholder:text-muted/70"
              aria-label="بحث في الحجوزات"
            />
            {text && (
              <button type="button" onClick={() => setText("")} className="text-muted hover:text-cream" aria-label="مسح البحث">
                <X className="size-4" />
              </button>
            )}
          </label>
          <Chips label="الفترة" value={scope} onChange={(v) => set({ scope: v === "upcoming" ? "" : v })} options={SCOPES.map((s) => ({ ...s }))} />
          <select
            value={payment}
            onChange={(e) => set({ payment: e.target.value })}
            className="rounded-xl border border-line bg-raised px-3 py-2.5 text-[14px] text-cream outline-none focus:border-gold/60"
            aria-label="حالة الدفع"
          >
            <option value="" className="bg-surface">أي حالة دفع</option>
            <option value="UNPAID" className="bg-surface">مش مدفوع</option>
            <option value="PARTIALLY_PAID" className="bg-surface">مدفوع جزئي</option>
            <option value="PAID" className="bg-surface">مدفوع</option>
          </select>
        </div>

        <div role="tablist" aria-label="حالة الحجز" className="flex flex-wrap gap-1.5 border-b border-line pb-3">
          {STATUSES.map((s) => {
            const active = s.value === status;
            const n = s.value ? counts?.[s.value] : allCount;
            return (
              <button
                key={s.value || "all"}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => set({ status: s.value })}
                className={cx(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[14px] transition",
                  active ? "bg-navy text-on-accent font-bold dark:text-cream" : "text-muted hover:bg-raised hover:text-cream"
                )}
              >
                {s.label}
                {n !== undefined && <span className={cx("rounded-md px-1.5 text-[12px]", active ? "bg-white/20" : "bg-raised-2")}>{num(n)}</span>}
              </button>
            );
          })}
        </div>

        {list.error && <ErrorBox error={errorMessage(list.error)} onRetry={() => list.refetch()} />}

        {list.isPending ? (
          <div className="flex flex-col gap-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : rows.length === 0 ? (
          <Empty>{q ? "مفيش حجوزات بالبحث ده." : scope === "upcoming" ? "مفيش حجوزات جاية بالفلتر ده." : "مفيش حجوزات بالفلتر ده."}</Empty>
        ) : (
          <ul className={cx("flex flex-col", list.isFetching && "opacity-70 transition-opacity")}>
            {rows.map((b) => (
              <BookingLine key={b.id} b={b} onOpen={() => setOpenId(b.id)} />
            ))}
          </ul>
        )}

        {pg && pg.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 pt-1 text-[13px] text-muted">
            <span>
              {num((pg.page - 1) * pg.limit + 1)}–{num(Math.min(pg.total, pg.page * pg.limit))} من {num(pg.total)}
            </span>
            <div className="flex gap-2">
              <Button size="sm" disabled={pg.page <= 1} onClick={() => set({ page: String(pg.page - 1) })} aria-label="الصفحة اللي قبل">
                <ChevronRight className="size-4" /> اللي قبل
              </Button>
              <Button size="sm" disabled={pg.page >= pg.totalPages} onClick={() => set({ page: String(pg.page + 1) })} aria-label="الصفحة اللي بعد">
                اللي بعد <ChevronLeft className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </section>

      {open && <BookingDialog key={open.id} b={open} onClose={() => setOpenId(null)} />}
    </Page>
  );
}

function BookingLine({ b, onOpen }: { b: BookingRow; onOpen: () => void }) {
  const st = BOOKING_STATUS[b.status];
  const today = b.bookingDate === todayKey();
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl px-1 py-3 text-right transition hover:bg-raised sm:gap-4 sm:px-2">
        <div className={cx("flex w-[56px] shrink-0 sm:w-[64px] flex-col items-center rounded-xl border py-1.5", today ? "border-gold/60 bg-gold/10" : "border-line bg-raised")}>
          <span className="text-[11px] text-muted">{today ? "النهارده" : weekdayShort(b.bookingDate)}</span>
          <span className="text-[20px] font-bold leading-tight text-cream">{Number(b.bookingDate.slice(8, 10))}</span>
          <span className="text-[11px] text-muted">{monthName(b.bookingDate)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-[15px] font-bold text-cream">
            <span className="truncate">{b.customer.name}</span>
            <span className="ltr text-[12px] font-normal text-muted">#{b.ref}</span>
          </div>
          <div className="mt-0.5 text-[13px] text-muted sm:truncate">
            {timeRange(b.startTime, b.endTime)} · {b.vehicle.name} · {b.driver.fullName}
          </div>
        </div>
        <div className="hidden w-[110px] shrink-0 text-left text-[15px] font-bold text-cream sm:block">{egp(b.totalPrice)}</div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:w-[118px]">
          <Badge tone={b.tripStatus === "INPROGRESS" || b.tripStatus === "ARRIVED" ? "gold" : st.tone}>
            {b.tripStatus === "INPROGRESS" ? "في الطريق" : b.tripStatus === "ARRIVED" ? "وصل" : st.label}
          </Badge>
          {b.status !== "CANCELLED" ? (
            <Badge tone={PAY[b.paymentStatus].tone}>{PAY[b.paymentStatus].label}</Badge>
          ) : b.depositOutcome ? (
            <Badge tone="muted">{b.depositOutcome === "REFUNDED" ? "العربون رجع" : "العربون اتحجز"}</Badge>
          ) : null}
        </div>
      </button>
    </li>
  );
}

const ERRORS: [RegExp, string][] = [
  [/Cannot cancel booking with status COMPLETED/i, "الحجز ده خلص، مينفعش يتلغي."],
  [/Invalid booking status transition|cannot set this booking/i, "الحالة دي مش متاحة للحجز ده دلوقتي."],
];
const actionError = (e: unknown) => {
  if (e instanceof ApiError) for (const [re, say] of ERRORS) if (re.test(e.message)) return say;
  return errorMessage(e);
};

/** One booking: details, confirm / complete, payments, cancel with the deposit outcome shown first. */
function BookingDialog({ b, onClose }: { b: BookingRow; onClose: () => void }) {
  const qc = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const refresh = () => ["bookings", "day", "overview", "recent-bookings", "audit", "customer-analytics"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const setStatus = useMutation({
    mutationFn: (status: BookingStatus) => api.patch(`/bookings/${b.id}/status`, { status }),
    onSuccess: refresh,
  });
  const st = BOOKING_STATUS[b.status];
  const remaining = Math.max(0, Math.round((b.totalPrice - b.paid) * 100) / 100);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-[18px] border border-line bg-surface p-0 text-cream backdrop:bg-ink/70 backdrop:backdrop-blur-sm"
      aria-label={`الحجز ${b.ref}`}
    >
      <div className="flex flex-col gap-4 p-[22px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] text-muted">
              <span className="ltr">#{b.ref}</span> · اتعمل {relativeStamp(b.createdAt)}
            </div>
            <h2 className="mt-1 text-[20px] font-bold">
              {weekdayShort(b.bookingDate)} {dayMonth(b.bookingDate)} · {timeRange(b.startTime, b.endTime)}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
            <button type="button" onClick={() => dialog.current?.close()} className="text-muted hover:text-cream" aria-label="إغلاق">
              <X className="size-5" />
            </button>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 text-[14px]">
          <Info k="العميل" v={<Link to={`/customers/${b.customer.id}`} className="font-bold hover:text-gold">{b.customer.name}</Link>} sub={<span className="ltr">{b.customer.phoneNumber}</span>} />
          <Info k="العربية" v={<Link to={`/fleet/${b.vehicle.id}`} className="font-bold hover:text-gold">{b.vehicle.name}</Link>} sub={<span className="ltr">{b.vehicle.plateNumber}</span>} />
          <Info k="السائق" v={<Link to={`/drivers/${b.driver.id}`} className="font-bold hover:text-gold">{b.driver.fullName}</Link>} />
          <Info k="المناسبة" v={b.eventType || "—"} sub={b.packageId ? "جزء من باقة" : undefined} />
          <div className="col-span-2 rounded-xl border border-line bg-raised px-3 py-2.5">
            <div className="text-[12px] text-muted">الطريق</div>
            <div className="mt-0.5 font-bold">{b.startPoint} ← {b.endPoint}</div>
          </div>
          {b.notes && (
            <div className="col-span-2 rounded-xl border border-line bg-raised px-3 py-2.5">
              <div className="text-[12px] text-muted">ملاحظات</div>
              <div className="mt-0.5">{b.notes}</div>
            </div>
          )}
        </dl>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { k: "الإجمالي", v: egp(b.totalPrice), c: "text-cream" },
            { k: "اتدفع", v: egp(b.paid), c: "text-mint" },
            { k: b.status === "CANCELLED" ? "رجع للمحفظة" : "الباقي", v: egp(b.status === "CANCELLED" ? b.depositRefunded : remaining), c: b.status === "CANCELLED" ? "text-cream" : remaining > 0 ? "text-rose" : "text-mint" },
          ].map((x) => (
            <div key={x.k} className="rounded-xl border border-line bg-raised px-2 py-2.5">
              <div className="text-[12px] text-muted">{x.k}</div>
              <div className={`text-[16px] font-bold ${x.c}`}>{x.v}</div>
            </div>
          ))}
        </div>

        {b.status === "CANCELLED" && b.cancelledAt && (
          <p className="rounded-xl border border-line bg-raised px-3 py-2.5 text-[13px] text-muted">
            اتلغى {relativeStamp(b.cancelledAt)}.{" "}
            {b.depositOutcome === "REFUNDED" ? `رجع ${egp(b.depositRefunded)} لمحفظة العميل.` : b.depositOutcome === "KEPT" ? `العربون اتحجز${b.depositRefunded > 0 ? ` ورجع ${egp(b.depositRefunded)} (الزيادة فوق العربون)` : ""}.` : "مكانش فيه فلوس مدفوعة."}
          </p>
        )}

        {setStatus.error && <ErrorBox error={actionError(setStatus.error)} />}

        {cancelling ? (
          <CancelPanel b={b} onBack={() => setCancelling(false)} onDone={() => { refresh(); dialog.current?.close(); }} />
        ) : (
          b.status !== "CANCELLED" && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              {b.status === "PENDING" && (
                <Button variant="primary" disabled={setStatus.isPending} onClick={() => setStatus.mutate("CONFIRMED")}>
                  أكّد الحجز
                </Button>
              )}
              {b.status === "CONFIRMED" && b.bookingDate <= todayKey() && (
                <Button variant="primary" disabled={setStatus.isPending} onClick={() => setStatus.mutate("COMPLETED")}>
                  الرحلة خلصت
                </Button>
              )}
              {b.status !== "COMPLETED" && (
                <Button onClick={() => setPaying(true)}>
                  <CreditCard className="size-4" /> الدفع
                </Button>
              )}
              {(b.status === "PENDING" || b.status === "CONFIRMED") && (
                <Button variant="danger" className="ms-auto" onClick={() => setCancelling(true)}>
                  إلغاء الحجز
                </Button>
              )}
            </div>
          )
        )}
      </div>
      {paying && <PaymentDialog booking={b} onClose={() => setPaying(false)} />}
    </dialog>
  );
}

function Info({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-raised px-3 py-2.5">
      <dt className="text-[12px] text-muted">{k}</dt>
      <dd className="mt-0.5">{v}</dd>
      {sub && <dd className="text-[12px] text-muted">{sub}</dd>}
    </div>
  );
}

type Decision = "policy" | "refund" | "keep";

/** Shows what happens to the money before cancelling; the admin can refund or keep the deposit instead. */
function CancelPanel({ b, onBack, onDone }: { b: BookingRow; onBack: () => void; onDone: () => void }) {
  const terms = useQuery({ queryKey: ["cancellation", b.id], queryFn: () => api.get<CancellationTerms>(`/bookings/${b.id}/cancellation`) });
  const [decide, setDecide] = useState(false);
  const [choice, setChoice] = useState<Decision>("policy");
  const cancel = useMutation({
    mutationFn: () => api.raw("DELETE", `/bookings/${b.id}`, choice === "policy" ? {} : { refundDeposit: choice === "refund" }),
    onSuccess: onDone,
  });
  const t = terms.data;
  const deposit = Math.min(b.paid, b.depositRequired);
  const preview = !t ? null : choice === "refund" ? { refund: t.paid, kept: 0 } : choice === "keep" ? { refund: Math.max(0, t.paid - deposit), kept: deposit } : { refund: t.refund, kept: t.kept };
  const free = t ? new Date(t.freeUntil).getTime() >= Date.now() : false;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-wine/50 bg-wine/8 p-4">
      <div className="text-[15px] font-bold">إلغاء الحجز</div>
      {terms.isPending ? (
        <Skeleton className="h-12" />
      ) : terms.error ? (
        <ErrorBox error={errorMessage(terms.error)} onRetry={() => terms.refetch()} />
      ) : t && preview ? (
        <>
          {t.paid <= 0 ? (
            <p className="text-[14px] text-muted">مفيش فلوس مدفوعة على الحجز ده، فمفيش حاجة ترجع.</p>
          ) : (
            <>
              <p className="text-[14px] leading-relaxed text-muted">
                العميل دافع <b className="text-cream">{egp(t.paid)}</b>.{" "}
                {free
                  ? `الإلغاء لسه مجاني (قبل الرحلة بـ ${t.freeCancellationHours} ساعة أو أكتر).`
                  : `فات وقت الإلغاء المجاني (${t.freeCancellationHours} ساعة قبل الرحلة)، فالعربون بيتحجز حسب السياسة.`}
              </p>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl border border-line bg-surface px-2 py-2">
                  <div className="text-[12px] text-muted">هيرجع لمحفظة العميل</div>
                  <div className="text-[16px] font-bold text-mint">{egp(preview.refund)}</div>
                </div>
                <div className="rounded-xl border border-line bg-surface px-2 py-2">
                  <div className="text-[12px] text-muted">هيتحجز (العربون)</div>
                  <div className="text-[16px] font-bold text-rose">{egp(preview.kept)}</div>
                </div>
              </div>
              <Toggle checked={decide} onChange={(v) => { setDecide(v); if (!v) setChoice("policy"); }} label={<span className="text-[14px]">أقرر أنا بدل السياسة</span>} />
              {decide && (
                <Chips
                  label="العربون"
                  value={choice}
                  onChange={setChoice}
                  options={[
                    { value: "policy", label: "حسب السياسة" },
                    { value: "refund", label: "رجّع كل المدفوع" },
                    { value: "keep", label: "احجز العربون" },
                  ]}
                />
              )}
            </>
          )}
        </>
      ) : null}
      {cancel.error && <ErrorBox error={actionError(cancel.error)} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" disabled={!t || cancel.isPending} onClick={() => cancel.mutate()}>
          {cancel.isPending ? "بيتلغي…" : "أكّد الإلغاء"}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          رجوع
        </Button>
      </div>
    </div>
  );
}
