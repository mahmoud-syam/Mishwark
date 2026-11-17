import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { CustomerAnalytics, CustomerHit, Vehicle } from "../lib/types";
import { egp, initials, maskPhone, num, todayKey } from "../lib/format";
import { EVENT_TYPES, SAVED_PLACES, toPlaceValue } from "../lib/places";
import { Avatar, Button, cx, ErrorBox, Field, fieldControl, Page, PageHeader, Panel, Skeleton, Toggle } from "../components/ui";

interface Estimate {
  basePrice: number;
  distancePrice: number;
  timePrice: number;
  totalPrice: number;
  referralDiscount: number;
}

const addHours = (hhmm: string, h: number) => {
  const [hh, mm] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, hh * 60 + mm + h * 60);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function BookOnBehalf() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isSuperAdmin } = useAuth();
  const [params] = useSearchParams();

  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [date, setDate] = useState(todayKey());
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("22:00");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [driverId, setDriverId] = useState("");
  const [eventType, setEventType] = useState("");
  const [override, setOverride] = useState("");
  const [markPaid, setMarkPaid] = useState(false);
  const [touched, setTouched] = useState(false);

  // Prefill the customer when arriving from customer analytics (?customer=id).
  const preId = params.get("customer");
  const pre = useQuery({
    queryKey: ["customer-analytics", preId, "day"],
    queryFn: () => api.get<CustomerAnalytics>(`/admin/customers/${preId}/analytics?period=day`),
    enabled: Boolean(preId),
  });
  useEffect(() => {
    if (pre.data && !customer) {
      const c = pre.data.customer;
      setCustomer({ id: c.id, name: c.name, phoneNumber: c.phoneNumber, bookingsCount: pre.data.lifetime.bookings });
    }
  }, [pre.data, customer]);

  const vehicles = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => api.raw<{ data: Vehicle[] }>("GET", "/vehicles").then((r) => r.data),
  });
  const drivers = useQuery({
    queryKey: ["drivers-assignable"],
    queryFn: () => api.get<{ id: string; fullName: string; status: string }[]>("/admin/drivers-assignable"),
  });
  const bookable = (vehicles.data ?? []).filter((v) => v.status !== "MAINTENANCE");

  const fromValue = toPlaceValue(from);
  const toValue = toPlaceValue(to);
  const estimateKey = useDebounced(JSON.stringify([vehicleId, fromValue, toValue, customer?.id ?? null]), 450);
  const estimate = useQuery({
    queryKey: ["estimate", estimateKey],
    queryFn: () => {
      const [v, s, e, c] = JSON.parse(estimateKey);
      // With the customer, the quote includes their first-booking referral discount.
      return api.post<Estimate>("/bookings/estimate-price", { vehicleId: v, startPoint: s, endPoint: e, ...(c ? { customerId: c } : {}) });
    },
    enabled: Boolean(vehicleId && fromValue && toValue) && estimateKey === JSON.stringify([vehicleId, fromValue, toValue, customer?.id ?? null]),
    retry: false,
  });

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ id: string; ref: string; bookingDate: string }>("/admin/bookings", {
        customerId: customer!.id,
        vehicleId,
        driverId: driverId || undefined,
        bookingDate: date,
        startTime,
        endTime,
        startPoint: fromValue,
        endPoint: toValue,
        eventType: eventType || undefined,
        priceOverride: isSuperAdmin && override !== "" ? Number(override) : undefined,
        markPaid,
      }),
    onSuccess: (b) => {
      ["overview", "recent-bookings", "calendar", "day", "fleet", "audit", "customer-analytics"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      nav(`/day/${b.bookingDate}?booking=${b.id}`);
    },
  });

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!customer) p.push("اختار العميل");
    if (!vehicleId) p.push("اختار العربية");
    if (!fromValue || !toValue) p.push("حدد نقطة الانطلاق والوجهة");
    if (date < todayKey()) p.push("التاريخ لازم يكون النهاردة أو بعد كده");
    if (endTime <= startTime) p.push("ميعاد النهاية لازم يكون بعد البداية");
    if (override !== "" && !(Number(override) > 0)) p.push("السعر اليدوي لازم يكون رقم أكبر من صفر");
    return p;
  }, [customer, vehicleId, fromValue, toValue, date, startTime, endTime, override]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problems.length === 0) submit.mutate();
  };

  const finalPrice = override !== "" && isSuperAdmin ? Number(override) : estimate.data?.totalPrice;

  return (
    <Page width="medium">
      <PageHeader back="/" eyebrow="Super Admin" title="احجز نيابة عن عميل" />
      <form onSubmit={onSubmit} className="flex flex-col gap-[18px]" noValidate>
        <CustomerStep customer={customer} onChange={setCustomer} />

        <Panel title="٢. تفاصيل الحجز">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Field label="العربية">
              {vehicles.isPending ? (
                <Skeleton className="h-5" />
              ) : (
                <select className={fieldControl} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
                  <option value="" className="bg-surface">اختار عربية…</option>
                  {bookable.map((v) => (
                    <option key={v.id} value={v.id} className="bg-surface">
                      {v.make} {v.model} · {v.capacity} راكب
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="التاريخ">
              <input className={`${fieldControl} ltr text-right`} type="date" min={todayKey()} value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="من">
              <input className={fieldControl} list="saved-places" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="نقطة الانطلاق" required />
            </Field>
            <Field label="إلى">
              <input className={fieldControl} list="saved-places" value={to} onChange={(e) => setTo(e.target.value)} placeholder="الوجهة" required />
            </Field>
            <Field label="الميعاد">
              <div className="flex items-center gap-2">
                <input
                  className={`${fieldControl} ltr text-right`}
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value);
                    setEndTime(addHours(e.target.value, 3));
                  }}
                  required
                  aria-label="ميعاد البداية"
                />
                <span className="text-[11px] text-muted">لحد</span>
                <input className={`${fieldControl} ltr text-right`} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required aria-label="ميعاد النهاية" />
              </div>
            </Field>
            <Field label="السائق">
              <select className={fieldControl} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="" className="bg-surface">تعيين تلقائي لأول سائق متاح</option>
                {(drivers.data ?? []).map((d) => (
                  <option key={d.id} value={d.id} className="bg-surface">
                    {d.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="نوع المناسبة (اختياري)">
              <input className={fieldControl} list="event-types" value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="زفة فرح، استقبال مطار…" />
            </Field>
          </div>
          <datalist id="saved-places">
            {SAVED_PLACES.map((p) => (
              <option key={p.label} value={p.label} />
            ))}
          </datalist>
          <datalist id="event-types">
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <p className="mt-2.5 text-[10px] text-muted">الأماكن المحفوظة بتتسعّر بالمسافة الفعلية. أي مكان تاني بيتحدد على الخريطة من السيرفر.</p>
        </Panel>

        <Panel title="٣. السعر والدفع">
          <div className="flex items-center justify-between pb-3 text-[11px] text-muted">
            <span>السعر المحسوب تلقائيًا</span>
            <span className="ltr text-[13px] font-bold text-cream">
              {estimate.isFetching ? <Skeleton className="inline-block h-4 w-16" /> : estimate.data ? egp(estimate.data.totalPrice) : "—"}
            </span>
          </div>
          {estimate.data && (
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
              <span>أساسي {num(estimate.data.basePrice)}</span>
              <span>مسافة {num(estimate.data.distancePrice)}</span>
              {estimate.data.timePrice > 0 && <span>وقت {num(estimate.data.timePrice)}</span>}
              {estimate.data.referralDiscount > 0 && <span className="text-mint">خصم أول حجز (إحالة) −{num(estimate.data.referralDiscount)}</span>}
            </div>
          )}
          {estimate.error && <p className="mb-3 text-[11px] text-rose">{estimate.error instanceof ApiError ? estimate.error.message : "مش قادر أحسب السعر دلوقتي."}</p>}
          <Field label="تعديل يدوي للسعر (اختياري)" hint={isSuperAdmin ? "— بصلاحية Super Admin —" : "التعديل اليدوي متاح للـ Super Admin بس"}>
            <input
              className={`${fieldControl} ltr text-right`}
              type="number"
              min={0}
              step={50}
              disabled={!isSuperAdmin}
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              placeholder={estimate.data ? String(Math.round(estimate.data.totalPrice)) : ""}
            />
          </Field>
          <div className="mt-3">
            <Toggle checked={markPaid} onChange={setMarkPaid} label="تسجيل كحجز مدفوع مقدمًا (كاش/تحويل يدوي)" />
          </div>
        </Panel>

        {touched && problems.length > 0 && <ErrorBox error={problems.join(" · ")} />}
        {submit.error && <ErrorBox error={submitError(submit.error)} />}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-muted">{finalPrice != null && <>الإجمالي: <b className="text-cream">{egp(finalPrice)}</b></>}</span>
          <Button type="submit" variant="primary" size="lg" disabled={submit.isPending} className="min-w-[230px]">
            {submit.isPending ? "جاري الحجز…" : "تأكيد الحجز نيابة عن العميل"}
          </Button>
        </div>
      </form>
    </Page>
  );
}

function submitError(e: unknown) {
  if (e instanceof ApiError && e.status === 409) return "العربية أو السائق محجوزين في نفس الميعاد ده. اختار وقت أو عربية تانية.";
  return errorMessage(e);
}

// ------------------------------------------------------------ customer step
function CustomerStep({ customer, onChange }: { customer: CustomerHit | null; onChange: (c: CustomerHit | null) => void }) {
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(term.trim());
  const search = useQuery({
    queryKey: ["customer-search", debounced],
    queryFn: () => api.get<CustomerHit[]>(`/admin/customers/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2 && !customer,
  });

  return (
    <Panel title="١. حدد العميل">
      {customer ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-gold bg-gold/8 p-3">
          <div className="flex items-center gap-3">
            <Avatar text={initials(customer.name)} tone="gold" />
            <div>
              <div className="text-[13px] font-bold text-cream">{customer.name}</div>
              <div className="text-[11px] text-muted">
                <span className="ltr">{maskPhone(customer.phoneNumber)}</span> · {customer.bookingsCount} حجوزات سابقة
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[16px] text-gold" aria-hidden>✓</span>
            <button type="button" className="text-[11px] text-muted underline-offset-4 hover:text-cream hover:underline" onClick={() => onChange(null)}>
              تغيير
            </button>
          </div>
        </div>
      ) : creating ? (
        <QuickCreate
          onCancel={() => setCreating(false)}
          onCreated={(c) => {
            onChange(c);
            setCreating(false);
          }}
        />
      ) : (
        <>
          <input className="field-input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="🔍 دور برقم موبايل أو اسم العميل…" aria-label="بحث عن عميل" />
          {debounced.length >= 2 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {search.isFetching && <Skeleton className="h-12 rounded-xl" />}
              {search.data?.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onChange(c)}
                    className="flex w-full items-center gap-3 rounded-xl border border-line bg-raised p-3 text-right transition hover:border-gold/60"
                  >
                    <Avatar text={initials(c.name)} size={32} tone="plain" />
                    <span>
                      <span className="block text-[12px] font-bold text-cream">{c.name}</span>
                      <span className="block text-[11px] text-muted">
                        <span className="ltr">{maskPhone(c.phoneNumber)}</span> · {c.bookingsCount} حجوزات سابقة
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {search.data && search.data.length === 0 && !search.isFetching && <li className="px-1 text-[11px] text-muted">مفيش عميل بالاسم أو الرقم ده.</li>}
            </ul>
          )}
          <p className="mt-3 text-center text-[11px] text-muted">
            مش لاقي العميل؟{" "}
            <button type="button" className="text-gold hover:underline" onClick={() => setCreating(true)}>
              أنشئ حساب جديد بسرعة ←
            </button>
          </p>
        </>
      )}
    </Panel>
  );
}

function QuickCreate({ onCreated, onCancel }: { onCreated: (c: CustomerHit) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const normalized = phone.trim().replace(/[\s-]/g, "").replace(/^0(?=1\d{9}$)/, "+20");
  const create = useMutation({
    mutationFn: () => api.post<CustomerHit>("/admin/customers", { name: name.trim(), phoneNumber: normalized }),
    onSuccess: onCreated,
  });
  const valid = name.trim().length >= 2 && /^\+?\d{8,15}$/.test(normalized);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Field label="اسم العميل">
          <input className={fieldControl} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="رقم الموبايل">
          <input className={`${fieldControl} ltr text-right`} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" />
        </Field>
      </div>
      {create.error && <ErrorBox error={create.error instanceof ApiError && create.error.status === 409 ? "فيه عميل مسجّل بالرقم ده بالفعل. دور عليه بالرقم." : errorMessage(create.error)} />}
      <div className="flex gap-2">
        <Button variant="primary" disabled={!valid || create.isPending} onClick={() => create.mutate()} className={cx("flex-1")}>
          {create.isPending ? "جاري الإنشاء…" : "إنشاء الحساب واختياره"}
        </Button>
        <Button onClick={onCancel}>إلغاء</Button>
      </div>
    </div>
  );
}
