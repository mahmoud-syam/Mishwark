import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { CustomerAnalytics, CustomerHit, PriceLine, PricingCatalog, ServiceType, Vehicle } from "../lib/types";
import PriceLines from "../components/PriceLines";
import { egp, initials, maskPhone, todayKey } from "../lib/format";
import { EVENT_TYPES } from "../lib/places";
import { LocationField, type PlacePoint } from "../components/PlacePicker";
import { Avatar, Button, cx, ErrorBox, Field, fieldControl, Page, PageHeader, Panel, Skeleton, Toggle } from "../components/ui";

interface Estimate {
  data: { totalPrice: number; depositRequired: number; basePrice: number; distancePrice: number; timePrice: number; referralDiscount: number };
  lines?: PriceLine[];
  depositRate?: number;
  bookedMinutes?: number | null;
  route: { distanceKm: number; source: string } | null;
}

const SERVICES: { value: ServiceType; label: string; hint: string }[] = [
  { value: "WEDDING", label: "زفاف", hint: "سعر ثابت للعربية بيشمل ساعات وكيلومترات" },
  { value: "TRIP", label: "مشوار خاص", hint: "من الشرقية لوجهة بسعر ثابت" },
  { value: "VIP", label: "VIP", hint: "سعر ثابت للمناسبة" },
];

/** Wraps past midnight: 22:00 + 3h = 01:00 (the trip ends the next morning). */
const addHours = (hhmm: string, h: number) => {
  const [hh, mm] = hhmm.split(":").map(Number);
  const t = (hh * 60 + mm + h * 60) % 1440;
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
  const [service, setService] = useState<ServiceType>("WEDDING");
  /** Private trip: a listed destination's id, or "other" for a place on the map. */
  const [destinationId, setDestinationId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [date, setDate] = useState(todayKey());
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("22:00");
  const [from, setFrom] = useState<PlacePoint | null>(null);
  const [to, setTo] = useState<PlacePoint | null>(null);
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
  // Only the chosen car's own drivers can drive it (main driver first).
  const drivers = useQuery({
    queryKey: ["drivers-assignable", vehicleId],
    queryFn: () => api.get<{ id: string; fullName: string; status: string; isPrimary?: boolean }[]>(`/admin/drivers-assignable?vehicleId=${vehicleId}`),
    enabled: Boolean(vehicleId),
  });
  useEffect(() => setDriverId(""), [vehicleId]);
  // The API lists only cars in service with a driver; maintenance is checked for the chosen date.
  const bookable = vehicles.data ?? [];

  // Prices, destinations and where private trips start (Pricing page).
  const catalog = useQuery({ queryKey: ["pricing-catalog"], queryFn: () => api.get<PricingCatalog>("/pricing") });
  const listed = service === "TRIP" && destinationId !== "" && destinationId !== "other";
  // A private trip starts at the company (it can still be changed on the map);
  // leaving "trip" clears that start so a wedding gets its own points.
  const isOrigin = (p: PlacePoint | null) => !!p && !!catalog.data && p.latitude === catalog.data.origin.latitude && p.longitude === catalog.data.origin.longitude;
  const chooseService = (next: ServiceType) => {
    if (next === service) return;
    if (next === "TRIP" && catalog.data) setFrom(catalog.data.origin);
    if (service === "TRIP" && isOrigin(from)) setFrom(null);
    setService(next);
  };
  useEffect(() => {
    if (service === "TRIP" && !from && catalog.data) setFrom(catalog.data.origin);
  }, [service, catalog.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exact coordinates from the map, with the name shown to the driver and customer.
  const fromValue = from;
  const toValue = listed ? null : to;
  const ready = Boolean(vehicleId) && (service === "TRIP" ? listed || Boolean(toValue) : Boolean(fromValue && toValue));
  const quoteBody = {
    vehicleId,
    serviceType: service,
    ...(listed && { destinationId }),
    ...(fromValue && { startPoint: fromValue }),
    ...(toValue && { endPoint: toValue }),
    startTime,
    endTime,
    ...(customer && { customerId: customer.id }),
  };
  const current = JSON.stringify(quoteBody);
  const estimateKey = useDebounced(current, 450);
  const estimate = useQuery({
    queryKey: ["estimate", estimateKey],
    // With the customer, the quote includes their package and first-booking referral discount.
    queryFn: () => api.raw<Estimate>("POST", "/bookings/estimate-price", JSON.parse(estimateKey)),
    enabled: ready && estimateKey === current,
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
        serviceType: service,
        destinationId: listed ? destinationId : undefined,
        startPoint: fromValue ?? undefined,
        endPoint: toValue ?? undefined,
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
    if (service === "TRIP" ? !listed && !toValue : !fromValue || !toValue) p.push(service === "TRIP" ? "اختار الوجهة" : "حدد نقطة الانطلاق والوجهة");
    if (date < todayKey()) p.push("التاريخ لازم يكون النهاردة أو بعد كده");
    if (endTime === startTime) p.push("ميعاد النهاية لازم يكون غير البداية");
    if (override !== "" && !(Number(override) > 0)) p.push("السعر اليدوي لازم يكون رقم أكبر من صفر");
    return p;
  }, [customer, vehicleId, fromValue, toValue, listed, service, date, startTime, endTime, override]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problems.length === 0) submit.mutate();
  };

  const finalPrice = override !== "" && isSuperAdmin ? Number(override) : estimate.data?.data.totalPrice;

  return (
    <Page width="medium">
      <PageHeader eyebrow="حجز بالتليفون أو في المكتب" title="احجز لعميل" />
      <form onSubmit={onSubmit} className="flex flex-col gap-[18px]" noValidate>
        <CustomerStep customer={customer} onChange={setCustomer} />

        <Panel title="٢. تفاصيل الحجز">
          <div role="radiogroup" aria-label="نوع الخدمة" className="mb-3 grid grid-cols-3 gap-2">
            {SERVICES.map((sv) => {
              const on = sv.value === service;
              return (
                <button
                  key={sv.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => chooseService(sv.value)}
                  className={cx("flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-right transition", on ? "border-gold bg-gold/10" : "border-line bg-raised hover:border-gold/50")}
                >
                  <span className={cx("text-[15px] font-bold", on ? "text-gold" : "text-cream")}>{sv.label}</span>
                  <span className="text-[12px] text-muted">{sv.hint}</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Field label="العربية">
              {vehicles.isPending ? (
                <Skeleton className="h-5" />
              ) : (
                <select className={fieldControl} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required aria-label="العربية">
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
            <LocationField which="from" value={from} other={to} onChange={setFrom} />
            {service === "TRIP" ? (
              <Field label="الوجهة">
                <select className={fieldControl} value={destinationId} onChange={(e) => setDestinationId(e.target.value)} aria-label="الوجهة">
                  <option value="" className="bg-surface">اختار الوجهة…</option>
                  {(catalog.data?.destinations ?? []).map((d) => (
                    <option key={d.id} value={d.id} className="bg-surface">
                      {d.name}
                    </option>
                  ))}
                  <option value="other" className="bg-surface">مكان تاني (على الخريطة)</option>
                </select>
              </Field>
            ) : (
              <LocationField which="to" value={to} other={from} onChange={setTo} />
            )}
            {service === "TRIP" && destinationId === "other" && <LocationField which="to" value={to} other={from} onChange={setTo} />}
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
                <span className="text-[13px] text-muted">لحد</span>
                <input className={`${fieldControl} ltr text-right`} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required aria-label="ميعاد النهاية" />
              </div>
              {endTime < startTime && <p className="mt-1.5 text-[13px] text-gold">الرحلة بتخلص تاني يوم الصبح</p>}
            </Field>
            <Field label="السائق">
              <select className={fieldControl} value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="السائق">
                <option value="" className="bg-surface">{vehicleId ? "تلقائي: أول سواق فاضي من سواقين العربية" : "اختار العربية الأول"}</option>
                {(drivers.data ?? []).map((d) => (
                  <option key={d.id} value={d.id} className="bg-surface">
                    {d.fullName}
                    {d.isPrimary ? " (الأساسي)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="نوع المناسبة (اختياري)">
              <input className={fieldControl} list="event-types" value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="زفة فرح، استقبال مطار…" />
            </Field>
          </div>
          <datalist id="event-types">
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <p className="mt-2.5 text-[12px] text-muted">دوس على "من" أو "إلى" عشان تدور على أي مكان في مصر أو تحط دبوس على الخريطة. السعر بيتحسب بالمسافة الفعلية بين النقطتين.</p>
        </Panel>

        <Panel title="٣. السعر والدفع">
          <div className="mb-3">
            {estimate.isFetching && !estimate.data ? (
              <Skeleton className="h-32" />
            ) : estimate.data?.lines ? (
              <div className={cx(estimate.isFetching && "opacity-60 transition-opacity")}>
                <PriceLines
                  lines={estimate.data.lines}
                  total={estimate.data.data.totalPrice}
                  deposit={estimate.data.data.depositRequired}
                  depositRate={estimate.data.depositRate}
                  distanceKm={estimate.data.route?.distanceKm}
                  distanceEstimated={estimate.data.route?.source === "haversine"}
                  bookedMinutes={estimate.data.bookedMinutes}
                />
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[13px] text-muted">
                {service === "TRIP" ? "اختار العربية والوجهة عشان يظهر السعر بالتفصيل." : "اختار العربية ونقطة الانطلاق والوجهة عشان يظهر السعر بالتفصيل."}
              </p>
            )}
          </div>
          {estimate.error && <p className="mb-3 text-[13px] text-rose">{estimate.error instanceof ApiError ? estimate.error.message : "مش قادر أحسب السعر دلوقتي."}</p>}
          <Field label="تعديل يدوي للسعر (اختياري)" hint={isSuperAdmin ? "— بصلاحية Super Admin —" : "التعديل اليدوي متاح للـ Super Admin بس"}>
            <input
              className={`${fieldControl} ltr text-right`}
              type="number"
              min={0}
              step={50}
              disabled={!isSuperAdmin}
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              placeholder={estimate.data ? String(Math.round(estimate.data.data.totalPrice)) : ""}
            />
          </Field>
          <div className="mt-3">
            <Toggle checked={markPaid} onChange={setMarkPaid} label="تسجيل كحجز مدفوع مقدمًا (كاش/تحويل يدوي)" />
          </div>
        </Panel>

        {touched && problems.length > 0 && <ErrorBox error={problems.join(" · ")} />}
        {submit.error && <ErrorBox error={submitError(submit.error)} />}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[14px] text-muted">{finalPrice != null && <>الإجمالي: <b className="text-cream">{egp(finalPrice)}</b></>}</span>
          <Button type="submit" variant="primary" size="lg" disabled={submit.isPending} className="min-w-[230px]">
            {submit.isPending ? "جاري الحجز…" : "تأكيد الحجز نيابة عن العميل"}
          </Button>
        </div>
      </form>
    </Page>
  );
}

/** The API's booking refusals, in Arabic. */
const BOOKING_ERRORS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/already passed/i, () => "الميعاد ده عدّى خلاص. اختار وقت بعد دلوقتي."],
  [/past date/i, () => "التاريخ ده عدّى."],
  [/up to (\d+) days ahead/i, (m) => `الحجز متاح لحد ${m[1]} يوم من النهارده بس.`],
  [/at least (\d+) minutes/i, (m) => `الرحلة لازم تكون ${m[1]} دقيقة على الأقل.`],
  [/must end by (\d\d:\d\d)/i, (m) => `الرحلة اللي بتعدّي نص الليل لازم تخلص قبل ${m[1]} الصبح.`],
  [/endTime must be later/i, () => "الرحلات بعد نص الليل مقفولة من الإعدادات. ميعاد النهاية لازم يكون بعد البداية."],
  [/maintenance/i, () => "العربية دي في الصيانة في اليوم ده."],
  [/no longer available/i, () => "العربية دي اتشالت من الأسطول."],
  [/licence has expired/i, () => "رخصة السائق ده منتهية. اختار سائق تاني أو سيبها تلقائي."],
  [/no driver of this car is free/i, () => "مفيش سواق من سواقين العربية فاضي في الميعاد ده."],
  [/no driver assigned/i, () => "العربية دي لسه ما اتحددلهاش سواقين. حددهم من صفحة الأسطول."],
  [/OFF or ON LEAVE/i, () => "السائق ده في إجازة أو مش شغال النهارده."],
];

function submitError(e: unknown) {
  if (e instanceof ApiError && e.status === 409) return "العربية أو السائق محجوزين في نفس الميعاد ده. اختار وقت أو عربية تانية.";
  if (e instanceof ApiError && e.status === 400) {
    for (const [re, say] of BOOKING_ERRORS) {
      const m = e.message.match(re);
      if (m) return say(m);
    }
  }
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
              <div className="text-[15px] font-bold text-cream">{customer.name}</div>
              <div className="text-[13px] text-muted">
                <span className="ltr">{maskPhone(customer.phoneNumber)}</span> · {customer.bookingsCount} حجوزات سابقة
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[18px] text-gold" aria-hidden>✓</span>
            <button type="button" className="text-[13px] text-muted underline-offset-4 hover:text-cream hover:underline" onClick={() => onChange(null)}>
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
          <input className="field-input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="دور برقم موبايل أو اسم العميل…" aria-label="بحث عن عميل" />
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
                      <span className="block text-[14px] font-bold text-cream">{c.name}</span>
                      <span className="block text-[13px] text-muted">
                        <span className="ltr">{maskPhone(c.phoneNumber)}</span> · {c.bookingsCount} حجوزات سابقة
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {search.data && search.data.length === 0 && !search.isFetching && <li className="px-1 text-[13px] text-muted">مفيش عميل بالاسم أو الرقم ده.</li>}
            </ul>
          )}
          <p className="mt-3 text-center text-[13px] text-muted">
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
