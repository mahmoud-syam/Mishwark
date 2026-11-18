import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, MessageSquareWarning, Phone, RotateCcw, Search, Star, X } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { dayMonth, maskPhone, num, relativeStamp, telHref, time12 } from "../lib/format";
import type { Pagination } from "../lib/api";
import type { ReviewCounts, ReviewDirection, ReviewPerson, ReviewRow } from "../lib/types";
import { SERVICE_LABEL } from "../components/PriceLines";
import { Badge, Button, cx, Empty, ErrorBox, Page, PageHeader, Skeleton, StatCard, StatGrid } from "../components/ui";

type Tab = "open" | "handled" | "all";
type ListReply = { data: ReviewRow[]; counts: ReviewCounts; complaintMaxRating: number; pagination: Pagination };

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const select = "rounded-xl border border-line bg-raised px-3 py-2.5 text-[14px] text-cream outline-none focus:border-gold/60";

/**
 * Every review with who wrote it, about whom and on which trip. Complaints (a
 * customer's low rating of a driver) are open until someone writes what was
 * done and marks them handled.
 */
export default function Reviews() {
  const [params, setParams] = useSearchParams();
  const tab = (["open", "handled", "all"].includes(params.get("tab") ?? "") ? params.get("tab") : "open") as Tab;
  const direction = (params.get("direction") as ReviewDirection | null) ?? "";
  const rating = params.get("rating") ?? "";
  const driverId = params.get("driver") ?? "";
  const customerId = params.get("customer") ?? "";
  const pinnedId = params.get("id");
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [text, setText] = useState(params.get("q") ?? "");
  const q = useDebounced(text.trim());

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

  const qs = new URLSearchParams({
    kind: tab === "all" ? "all" : "complaints",
    state: tab === "all" ? "all" : tab,
    page: String(page),
    limit: "20",
    ...(q && { q }),
    ...(tab === "all" && direction && { direction }),
    ...(rating && { rating }),
    ...(driverId && { driverId }),
    ...(customerId && { customerId }),
  });
  const list = useQuery({
    queryKey: ["reviews", qs.toString()],
    queryFn: () => api.raw<ListReply>("GET", `/admin/reviews?${qs}`),
    placeholderData: keepPreviousData,
  });
  // The complaint opened from a home alert, shown on top whatever the filters.
  const pinned = useQuery({ queryKey: ["review", pinnedId], queryFn: () => api.get<ReviewRow>(`/admin/reviews/${pinnedId}`), enabled: !!pinnedId });

  const rows = (list.data?.data ?? []).filter((r) => r.id !== pinnedId);
  const counts = list.data?.counts;
  const pg = list.data?.pagination;
  const subject = subjectName(list.data?.data ?? [], driverId, customerId, pinned.data);

  const tabs: { value: Tab; label: string; n?: number }[] = [
    { value: "open", label: "شكاوى مفتوحة", n: counts?.openComplaints },
    { value: "handled", label: "شكاوى اتحلت", n: counts?.handledComplaints },
    { value: "all", label: "كل التقييمات", n: counts?.all },
  ];

  return (
    <Page>
      <PageHeader eyebrow="آراء العملاء والسواقين" title="التقييمات والشكاوى" />

      <StatGrid>
        <StatCard loading={!counts} icon={<MessageSquareWarning />} label="شكاوى مستنية رد" value={counts ? num(counts.openComplaints) : ""} />
        <StatCard loading={!counts} icon={<CheckCircle2 />} label="شكاوى اتحلت" value={counts ? num(counts.handledComplaints) : ""} />
        <StatCard
          loading={!counts}
          icon={<Star />}
          label="متوسط تقييم السواقين"
          value={counts?.averageDriverRating != null ? `${counts.averageDriverRating.toFixed(1)} ★` : "—"}
          delta={list.data ? `الشكوى = تقييم ${list.data.complaintMaxRating} نجوم أو أقل` : ""}
          deltaTone="muted"
        />
      </StatGrid>

      {pinnedId && (
        <section aria-label="الشكوى اللي فتحتها" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-cream">الشكوى اللي فتحتها</h2>
            <button type="button" onClick={() => set({ id: "" })} className="text-[13px] text-muted hover:text-cream">
              اقفلها
            </button>
          </div>
          {pinned.isPending ? <Skeleton className="h-40" /> : pinned.error ? <ErrorBox error={errorMessage(pinned.error)} /> : <ReviewCard r={pinned.data!} highlight />}
        </section>
      )}

      <section className="card flex flex-col gap-4 p-[18px]">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2.5 focus-within:border-gold/60">
            <Search className="size-4 text-muted" aria-hidden />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="ابحث بالاسم أو الموبايل أو رقم الحجز أو التعليق"
              className="w-full bg-transparent text-[14px] text-cream outline-none placeholder:text-muted/70"
              aria-label="بحث في التقييمات"
            />
            {text && (
              <button type="button" onClick={() => setText("")} className="text-muted hover:text-cream" aria-label="مسح البحث">
                <X className="size-4" />
              </button>
            )}
          </label>
          {tab === "all" && (
            <select value={direction} onChange={(e) => set({ direction: e.target.value })} className={select} aria-label="مين قيّم مين">
              <option value="" className="bg-surface">كل التقييمات</option>
              <option value="CUSTOMER_TO_DRIVER" className="bg-surface">العملاء قيّموا السواقين</option>
              <option value="DRIVER_TO_CUSTOMER" className="bg-surface">السواقين قيّموا العملاء</option>
            </select>
          )}
          <select value={rating} onChange={(e) => set({ rating: e.target.value })} className={select} aria-label="عدد النجوم">
            <option value="" className="bg-surface">أي تقييم</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n} className="bg-surface">
                {n} {n === 1 ? "نجمة" : "نجوم"}
              </option>
            ))}
          </select>
        </div>

        {(driverId || customerId) && (
          <div className="flex">
            <span className="flex items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-3 py-1.5 text-[13px] font-bold text-gold">
              {driverId ? "السواق" : "العميل"}: {subject || "…"}
              <button type="button" onClick={() => set({ driver: "", customer: "" })} className="hover:text-cream" aria-label="شيل الفلتر">
                <X className="size-3.5" />
              </button>
            </span>
          </div>
        )}

        <div role="tablist" aria-label="نوع التقييمات" className="flex flex-wrap gap-1.5 border-b border-line pb-3">
          {tabs.map((t) => {
            const active = t.value === tab;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => set({ tab: t.value === "open" ? "" : t.value, direction: "" })}
                className={cx(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[14px] transition",
                  active ? "bg-navy font-bold text-on-accent dark:text-cream" : "text-muted hover:bg-raised hover:text-cream"
                )}
              >
                {t.label}
                {t.n !== undefined && (
                  <span className={cx("rounded-md px-1.5 text-[12px]", active ? "bg-white/20" : t.value === "open" && t.n > 0 ? "bg-wine/15 text-rose" : "bg-raised-2")}>
                    {num(t.n)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {list.error && <ErrorBox error={errorMessage(list.error)} onRetry={() => list.refetch()} />}

        {list.isPending ? (
          <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>
        ) : rows.length === 0 ? (
          <Empty>
            {q || rating || driverId || customerId
              ? "مفيش تقييمات بالفلتر ده."
              : tab === "open"
                ? "مفيش شكاوى مستنية رد. كله تمام."
                : tab === "handled"
                  ? "لسه مفيش شكاوى اتحلت."
                  : "لسه مفيش تقييمات."}
          </Empty>
        ) : (
          <ul className={cx("flex flex-col gap-3", list.isFetching && "opacity-70 transition-opacity")}>
            {rows.map((r) => (
              <li key={r.id}>
                <ReviewCard r={r} />
              </li>
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
    </Page>
  );
}

/** The filtered driver's or customer's name, taken from a review that names them. */
function subjectName(rows: ReviewRow[], driverId: string, customerId: string, extra?: ReviewRow) {
  const people = [...rows, ...(extra ? [extra] : [])].flatMap((r) => [r.reviewer, r.reviewee]);
  const hit = driverId ? people.find((p) => p.driverId === driverId) : customerId ? people.find((p) => p.userId === customerId) : undefined;
  return hit?.name ?? "";
}

function Stars({ n, size = 16 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${n} من 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} style={{ width: size, height: size }} className={i <= n ? "fill-gold text-gold" : "text-line"} aria-hidden />
      ))}
    </span>
  );
}

function PersonLink({ p }: { p: ReviewPerson }) {
  const to = p.driverId ? `/drivers/${p.driverId}` : `/customers/${p.userId}`;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {p.deleted ? (
        <span className="font-bold text-cream">{p.name} <span className="text-[12px] font-normal text-muted">(حساب محذوف)</span></span>
      ) : (
        <Link to={to} className="font-bold text-cream underline decoration-line underline-offset-4 hover:text-gold hover:decoration-gold">
          {p.name}
        </Link>
      )}
      {p.phone && (
        <a href={telHref(p.phone)} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-cream" dir="ltr" title="اتصل">
          <Phone className="size-3" aria-hidden /> {maskPhone(p.phone)}
        </a>
      )}
    </span>
  );
}

function Who({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[12px] text-muted">{label}</span>
      <div className="min-w-0 text-[15px]">{children}</div>
    </div>
  );
}

export function ReviewCard({ r, highlight }: { r: ReviewRow; highlight?: boolean }) {
  const toDriver = r.direction === "CUSTOMER_TO_DRIVER";
  const b = r.booking;
  return (
    <article
      className={cx(
        "flex flex-col gap-3 rounded-2xl border bg-surface p-4",
        highlight ? "border-gold shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-gold)_25%,transparent)]" : r.isComplaint && !r.handled ? "border-wine/50" : "border-line"
      )}
      aria-label={`تقييم ${r.overallRating} من ${r.reviewer.name}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Stars n={r.overallRating} />
          <span className="text-[14px] font-bold text-cream">{r.overallRating}/5</span>
          {r.isComplaint ? (
            r.handled ? <Badge tone="mint" dot>شكوى اتحلت</Badge> : <Badge tone="rose" dot>شكوى مفتوحة</Badge>
          ) : (
            <Badge tone="muted">{toDriver ? "العميل قيّم السواق" : "السواق قيّم العميل"}</Badge>
          )}
        </div>
        <time dateTime={r.createdAt} className="text-[13px] text-muted" title={new Date(r.createdAt).toLocaleString("ar-EG")}>
          {relativeStamp(r.createdAt)}
        </time>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Who label={toDriver ? "من العميل" : "من السواق"}>
          <PersonLink p={r.reviewer} />
        </Who>
        <Who label={toDriver ? "على السواق" : "على العميل"}>
          <PersonLink p={r.reviewee} />
        </Who>
      </div>

      {r.comment ? (
        <blockquote className="rounded-xl border-s-4 border-gold/60 bg-raised px-4 py-3 text-[15px] leading-relaxed text-cream">“{r.comment}”</blockquote>
      ) : (
        <p className="text-[13px] text-muted">من غير تعليق.</p>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted">
        {r.punctualityRating != null && <span>الالتزام بالميعاد: <b className="text-cream">{r.punctualityRating}★</b></span>}
        {r.vehicleRating != null && <span>العربية: <b className="text-cream">{r.vehicleRating}★</b></span>}
        {b && (
          <span>
            الرحلة:{" "}
            <Link to={`/bookings?scope=all&q=${b.ref}&booking=${b.id}`} className="font-bold text-cream underline decoration-line underline-offset-4 hover:text-gold" dir="ltr">
              {b.ref}
            </Link>
            {" · "}
            {dayMonth(b.date)} {time12(b.startTime)}
            {b.vehicle && ` · ${b.vehicle.name}`}
            {b.serviceType && ` · ${SERVICE_LABEL[b.serviceType]}`}
          </span>
        )}
      </div>

      {r.isComplaint && <Handling r={r} />}
    </article>
  );
}

function Handling({ r }: { r: ReviewRow }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: (body: { handled: boolean; note?: string }) => api.patch<ReviewRow>(`/admin/reviews/${r.id}`, body),
    onSuccess: (next) => {
      setNote("");
      qc.setQueryData(["review", r.id], next);
      qc.invalidateQueries({ queryKey: ["reviews"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  if (r.handled) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-mint/30 bg-mint/8 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1 text-[14px]">
          <span className="flex items-center gap-1.5 font-bold text-mint">
            <CheckCircle2 className="size-4" /> اتحلت {r.handled.by ? `بواسطة ${r.handled.by.name}` : ""} · {relativeStamp(r.handled.at)}
          </span>
          {r.handled.note && <span className="text-cream">{r.handled.note}</span>}
        </div>
        <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ handled: false })}>
          <RotateCcw className="size-4" /> افتحها تاني
        </Button>
        {save.error && <p role="alert" className="w-full text-[13px] font-bold text-rose">{errorMessage(save.error)}</p>}
      </div>
    );
  }

  const ok = note.trim().length >= 3;
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) save.mutate({ handled: true, note: note.trim() });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">اتعمل إيه في الشكوى دي؟</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="مثلًا: كلمنا العميل واعتذرنا، ونبّهنا على السواق"
          className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-cream outline-none placeholder:text-muted/70 focus:border-gold/60"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-muted">هتتسجل باسمك في سجل التوثيق.</span>
        <Button type="submit" variant="primary" size="sm" disabled={!ok || save.isPending}>
          <CheckCircle2 className="size-4" /> {save.isPending ? "بيتحفظ..." : "اتحلت"}
        </Button>
      </div>
      {save.error && <p role="alert" className="text-[13px] font-bold text-rose">{errorMessage(save.error)}</p>}
    </form>
  );
}
