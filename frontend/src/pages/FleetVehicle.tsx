import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Camera, TriangleAlert, Wrench } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, clashBookings, errorMessage, type ClashBooking } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dayMonth, egp, time12, todayKey } from "../lib/format";
import { FLEET_STATUS, MAINTENANCE_STATE, MAINTENANCE_TYPES, VEHICLE_CATEGORY } from "../lib/labels";
import type { DriverSummary, FleetDetail, VehicleCategory } from "../lib/types";
import { Badge, Button, cx, Empty, ErrorBox, Field, fieldControl, Page, PageHeader, Panel, Skeleton } from "../components/ui";
import { canManageFleet } from "./Fleet";

// ------------------------------------------------------------------ helpers
/** Arabic text for the API's fleet messages. */
const AR: Record<string, string> = {
  "This plate number is already registered to another car": "رقم اللوحة ده مسجّل لعربية تانية.",
  "Move or cancel this car's upcoming bookings before retiring it": "العربية عليها حجوزات جاية. انقلها لعربية تانية أو الغيها الأول:",
  "This car has bookings on those days. Move or cancel them first": "العربية عليها حجوزات في الأيام دي. انقلها أو الغيها الأول:",
  "Another maintenance is already scheduled on those days": "فيه صيانة تانية متسجّلة في نفس الأيام.",
  "Maintenance can't start in the past": "الصيانة ما ينفعش تبدأ في يوم فات.",
  "The end date must be on or after the start date": "تاريخ النهاية لازم يكون بعد البداية أو نفس اليوم.",
  "Maintenance can't be longer than 60 days": "الصيانة ما تزيدش عن 60 يوم.",
  "A car can have up to 12 photos": "أقصى عدد صور للعربية 12 صورة.",
  "Each photo must be 5 MB or smaller": "حجم الصورة لازم يكون 5 ميجا أو أقل.",
  "The main driver must be one of the car's drivers": "السواق الأساسي لازم يكون من سواقين العربية.",
  "These upcoming trips are with a driver you're removing. Move them to another driver first": "الرحلات دي مع سواق إنت بتشيله من العربية. انقلها لسواق تاني الأول:",
};
const msg = (e: unknown) => {
  if (e instanceof ApiError) {
    if (AR[e.message]) return AR[e.message];
    if (e.message.startsWith("Unsupported file type")) return "نوع الملف مش مدعوم. استخدم JPG أو PNG أو WEBP.";
    if (e.status === 422) return "في بيانات ناقصة أو مش مظبوطة. راجع الخانات.";
  }
  return errorMessage(e);
};

function ClashList({ bookings }: { bookings: ClashBooking[] }) {
  if (!bookings.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {bookings.map((b) => (
        <li key={b.id}>
          <Link to={`/day/${b.date}?booking=${b.id}`} className="text-[13px] text-gold hover:underline">
            <span className="ltr">#{b.ref}</span> · {dayMonth(b.date)} · {time12(b.startTime)} · {b.customer}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ErrorWithBookings({ error }: { error: unknown }) {
  return (
    <div className="rounded-xl border border-wine bg-wine/15 px-4 py-3 text-[14px] text-blush" role="alert">
      {msg(error)}
      <ClashList bookings={clashBookings(error)} />
    </div>
  );
}

const invalidateFleet = (qc: ReturnType<typeof useQueryClient>, id?: string) => {
  qc.invalidateQueries({ queryKey: ["fleet-list"] });
  qc.invalidateQueries({ queryKey: ["fleet"] });
  qc.invalidateQueries({ queryKey: ["overview"] });
  qc.invalidateQueries({ queryKey: ["audit"] });
  if (id) qc.invalidateQueries({ queryKey: ["fleet-car", id] });
};

// ------------------------------------------------------------- details form
type Form = {
  make: string; model: string; year: string; plateNumber: string; color: string; capacity: string; category: VehicleCategory;
  basePrice: string; pricePerKm: string; pricePerHour: string; luggage: string; description: string; features: string[];
};
const EMPTY: Form = {
  make: "", model: "", year: String(new Date().getFullYear()), plateNumber: "", color: "", capacity: "4", category: "LUXURY",
  basePrice: "0", pricePerKm: "0", pricePerHour: "0", luggage: "3", description: "", features: [],
};
const fromCar = (c: FleetDetail): Form => ({
  make: c.make, model: c.model, year: String(c.year), plateNumber: c.plateNumber, color: c.color, capacity: String(c.capacity), category: c.category,
  basePrice: String(c.basePrice), pricePerKm: String(c.pricePerKm), pricePerHour: String(c.pricePerHour), luggage: String(c.luggage),
  description: c.description.replace(/^\[demo\]\s*/, ""), features: c.features,
});
const NUM_FIELDS = ["year", "capacity", "basePrice", "pricePerKm", "pricePerHour", "luggage"] as const;
const toBody = (f: Form) => ({
  ...f,
  ...Object.fromEntries(NUM_FIELDS.map((k) => [k, Number(f[k])])),
  make: f.make.trim(), model: f.model.trim(), plateNumber: f.plateNumber.trim(), color: f.color.trim(), description: f.description.trim(),
});

function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  const year = Number(f.year);
  if (!f.make.trim()) e.make = "اكتب الماركة";
  if (!f.model.trim()) e.model = "اكتب الموديل";
  if (!f.plateNumber.trim()) e.plateNumber = "اكتب رقم اللوحة";
  if (!Number.isInteger(year) || year < 1950 || year > new Date().getFullYear() + 1) e.year = "سنة مش صحيحة";
  const cap = Number(f.capacity);
  if (!Number.isInteger(cap) || cap < 1 || cap > 60) e.capacity = "من 1 لـ 60";
  const lug = Number(f.luggage);
  if (!Number.isInteger(lug) || lug < 0 || lug > 30) e.luggage = "من 0 لـ 30";
  for (const k of ["basePrice", "pricePerKm", "pricePerHour"] as const) {
    const n = Number(f[k]);
    if (f[k].trim() === "" || !Number.isFinite(n) || n < 0) e[k] = "رقم موجب";
  }
  return e;
}

function FeaturePicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const q = useQuery({ queryKey: ["vehicle-features"], queryFn: () => api.get<string[]>("/admin/vehicle-features") });
  const [custom, setCustom] = useState("");
  const options = [...new Set([...(q.data ?? []), ...value])];
  const toggle = (f: string) => onChange(value.includes(f) ? value.filter((x) => x !== f) : [...value, f]);
  const add = () => {
    const t = custom.trim();
    if (t && t.length <= 30 && !value.includes(t)) onChange([...value, t]);
    setCustom("");
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="المميزات">
        {options.map((f) => {
          const on = value.includes(f);
          return (
            <button
              key={f}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => toggle(f)}
              className={cx("rounded-full border px-3 py-1.5 text-[13px] transition", on ? "border-gold bg-gold/15 text-gold" : "border-line text-muted hover:border-gold/50")}
            >
              {on ? "✓ " : ""}
              {f}
            </button>
          );
        })}
      </div>
      {!disabled && (
        <div className="flex items-center gap-2">
          <input
            className="w-48 rounded-lg border border-line bg-raised px-3 py-1.5 text-[14px] text-cream outline-none focus:border-gold/60"
            placeholder="ميزة جديدة…"
            value={custom}
            maxLength={30}
            aria-label="إضافة ميزة جديدة"
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button size="sm" onClick={add} disabled={!custom.trim()}>
            إضافة
          </Button>
        </div>
      )}
    </div>
  );
}

function DetailsForm({ car, canEdit, onCreated }: { car?: FleetDetail; canEdit: boolean; onCreated?: (id: string) => void }) {
  const qc = useQueryClient();
  const initial = useMemo(() => (car ? fromCar(car) : EMPTY), [car]);
  const [f, setF] = useState<Form>(initial);
  const [saved, setSaved] = useState(false);
  useEffect(() => setF(initial), [initial]);

  const errors = validate(f);
  const body = toBody(f);
  const base = toBody(initial);
  const changed = (Object.keys(body) as (keyof typeof body)[]).filter((k) => JSON.stringify(body[k]) !== JSON.stringify(base[k]));
  const typePrices = car?.typePrices;

  const save = useMutation({
    mutationFn: () =>
      car
        ? api.patch<{ id: string }>(`/admin/vehicles/${car.id}`, Object.fromEntries(changed.map((k) => [k, body[k]])))
        : api.post<{ id: string }>("/admin/vehicles", body),
    onSuccess: (res) => {
      invalidateFleet(qc, car?.id);
      setSaved(true);
      if (!car) onCreated?.(res.id);
    },
  });
  useEffect(() => {
    if (changed.length) setSaved(false);
  }, [changed.length]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const input = (k: keyof Form, label: string, opts: { numeric?: boolean; hint?: string; placeholder?: string } = {}) => (
    <Field label={label} hint={errors[k] && (f[k] !== initial[k] || save.isError) ? errors[k] : opts.hint}>
      <input
        className={cx(fieldControl, opts.numeric && "ltr text-right")}
        inputMode={opts.numeric ? "decimal" : undefined}
        value={f[k] as string}
        onChange={set(k)}
        disabled={!canEdit}
        placeholder={opts.placeholder}
        aria-label={label}
      />
    </Field>
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (Object.keys(errors).length === 0) save.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Panel title="البيانات الأساسية" bodyClassName="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {input("make", "الماركة", { placeholder: "مرسيدس" })}
        {input("model", "الموديل", { placeholder: "S-Class" })}
        {input("plateNumber", "رقم اللوحة", { placeholder: "أ ب ج 123" })}
        {input("color", "اللون", { placeholder: "أسود" })}
        {input("year", "سنة الصنع", { numeric: true })}
        {input("capacity", "عدد الركاب", { numeric: true })}
        <Field label="النوع">
          <select className={fieldControl} value={f.category} onChange={set("category")} disabled={!canEdit} aria-label="النوع">
            {Object.entries(VEHICLE_CATEGORY).map(([k, l]) => (
              <option key={k} value={k} className="bg-surface">
                {l}
              </option>
            ))}
          </select>
        </Field>
        {input("luggage", "عدد الشنط", { numeric: true })}
      </Panel>

      <Panel title="الأسعار" tag="0 = سعر النوع من الإعدادات" bodyClassName="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {input("basePrice", "سعر فتح الرحلة (ج.م)", { numeric: true, hint: typePrices && Number(f.basePrice) === 0 ? `هيتحسب ${egp(typePrices.basePrice)}` : undefined })}
        {input("pricePerKm", "سعر الكيلو (ج.م)", { numeric: true, hint: typePrices && Number(f.pricePerKm) === 0 ? `هيتحسب ${egp(typePrices.pricePerKm)}` : undefined })}
        {input("pricePerHour", "سعر الساعة (ج.م)", { numeric: true, hint: typePrices && Number(f.pricePerHour) === 0 ? `هيتحسب ${egp(typePrices.pricePerHour)}` : undefined })}
      </Panel>

      <Panel title="اللي بيظهر للعميل في التطبيق" bodyClassName="flex flex-col gap-3">
        <FeaturePicker value={f.features} onChange={(features) => setF({ ...f, features })} disabled={!canEdit} />
        <Field label="الوصف">
          <textarea
            className={cx(fieldControl, "min-h-20 resize-y font-normal")}
            value={f.description}
            maxLength={1000}
            onChange={set("description")}
            disabled={!canEdit}
            placeholder="عربية لوكس مثالية للأفراح والمناسبات…"
            aria-label="الوصف"
          />
        </Field>
      </Panel>

      {save.error && <ErrorBox error={msg(save.error)} />}
      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {saved && !changed.length && <span className="fade-in text-[13px] text-mint">اتحفظ ✓</span>}
          {car && changed.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setF(initial)} disabled={save.isPending}>
              إلغاء التغييرات
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={save.isPending || Object.keys(errors).length > 0 || (!!car && changed.length === 0)}>
            {save.isPending ? "بيحفظ…" : car ? (changed.length ? `حفظ (${changed.length})` : "حفظ") : "إضافة العربية"}
          </Button>
        </div>
      )}
    </form>
  );
}

// ------------------------------------------------------------------- photos
function Photos({ car, canEdit }: { car: FleetDetail; canEdit: boolean }) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (files: FileList) => {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("images", f));
      return api.upload(`/admin/vehicles/${car.id}/images`, form);
    },
    onSettled: () => {
      if (file.current) file.current.value = "";
      invalidateFleet(qc, car.id);
    },
  });
  const remove = useMutation({ mutationFn: (imageId: string) => api.del(`/admin/vehicles/${car.id}/images/${imageId}`), onSuccess: () => invalidateFleet(qc, car.id) });
  const cover = useMutation({ mutationFn: (imageId: string) => api.patch(`/admin/vehicles/${car.id}/images/${imageId}/cover`), onSuccess: () => invalidateFleet(qc, car.id) });
  const err = upload.error ?? remove.error ?? cover.error;

  return (
    <Panel
      title="الصور"
      tag={`${car.images.length} من 12 · أول صورة هي الغلاف في التطبيق`}
      bodyClassName="flex flex-col gap-3"
    >
      {car.images.length === 0 ? (
        <Empty>لسه مفيش صور. العميل هيشوف أيقونة بدل الصورة.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {car.images.map((img) => (
            <div key={img.id} className="group relative overflow-hidden rounded-xl border border-line">
              <img src={img.imageUrl} alt="" className="h-28 w-full object-cover" loading="lazy" />
              {img.isCover && <span className="absolute right-2 top-2 rounded-full bg-gold px-2 py-0.5 text-[12px] font-bold text-ink">الغلاف</span>}
              {canEdit && (
                <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-ink/75 p-1.5 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                  {!img.isCover ? (
                    <button type="button" className="text-[12px] text-cream hover:text-gold" onClick={() => cover.mutate(img.id)}>
                      اجعلها الغلاف
                    </button>
                  ) : (
                    <span />
                  )}
                  <button type="button" className="text-[12px] text-rose hover:underline" onClick={() => remove.mutate(img.id)} aria-label="حذف الصورة">
                    حذف
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {err && <ErrorBox error={msg(err)} />}
      {canEdit && car.images.length < 12 && (
        <div className="flex items-center gap-3">
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            aria-label="رفع صور"
            onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)}
          />
          <Button onClick={() => file.current?.click()} disabled={upload.isPending}>
            <Camera className="size-4" /> {upload.isPending ? "بيرفع…" : "رفع صور"}
          </Button>
          <span className="text-[12px] text-muted">JPG أو PNG أو WEBP · لحد 5 ميجا للصورة</span>
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ drivers
function Drivers({ car, canEdit }: { car: FleetDetail; canEdit: boolean }) {
  const qc = useQueryClient();
  const all = useQuery({ queryKey: ["drivers-summary", 100], queryFn: () => api.get<DriverSummary[]>("/admin/drivers-summary?limit=100") });
  const initial = useMemo(() => ({ ids: car.drivers.map((d) => d.id), primary: car.drivers.find((d) => d.isPrimary)?.id ?? car.drivers[0]?.id ?? "" }), [car]);
  const [ids, setIds] = useState(initial.ids);
  const [primary, setPrimary] = useState(initial.primary);
  useEffect(() => {
    setIds(initial.ids);
    setPrimary(initial.primary);
  }, [initial]);
  const dirty = JSON.stringify(ids) !== JSON.stringify(initial.ids) || (ids.length > 0 && primary !== initial.primary);
  const names = new Map((all.data ?? []).map((d) => [d.id, d]));
  car.drivers.forEach((d) => !names.has(d.id) && names.set(d.id, { id: d.id, name: d.name, status: d.status } as DriverSummary));

  const save = useMutation({
    mutationFn: () => api.put(`/admin/vehicles/${car.id}/drivers`, { driverIds: ids, ...(ids.length && { primaryDriverId: primary || ids[0] }) }),
    onSuccess: () => invalidateFleet(qc, car.id),
  });
  const add = (id: string) => {
    if (!id || ids.includes(id)) return;
    setIds([...ids, id]);
    if (!primary) setPrimary(id);
  };
  const remove = (id: string) => {
    const next = ids.filter((x) => x !== id);
    setIds(next);
    if (primary === id) setPrimary(next[0] ?? "");
  };

  return (
    <Panel title="السواقين" tag="بس هما اللي يسوقوا العربية دي" bodyClassName="flex flex-col gap-3">
      {ids.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2.5 text-[13px] text-cream"><TriangleAlert className="size-4 shrink-0 text-gold" /> من غير سواق العربية مش هتظهر للعملاء ولا تتحجز.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {ids.map((id) => {
            const d = names.get(id);
            return (
              <li key={id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3 py-2">
                <label className="flex items-center gap-2 text-[14px] text-cream">
                  <input type="radio" name="primary-driver" checked={primary === id} onChange={() => setPrimary(id)} disabled={!canEdit} className="accent-[var(--color-gold)]" />
                  <span className="font-bold">{d?.name ?? "…"}</span>
                  {primary === id && <span className="text-[12px] text-gold">الأساسي</span>}
                  {d && d.status !== "ACTIVE" && <span className="text-[12px] text-muted">({d.status === "ONLEAVE" ? "إجازة" : d.status === "OFF" ? "خارج الخدمة" : "في رحلة"})</span>}
                </label>
                {canEdit && (
                  <button type="button" className="text-[13px] text-rose hover:underline" onClick={() => remove(id)}>
                    شيل
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <>
          <select
            className="rounded-xl border border-line bg-raised px-3 py-2 text-[14px] text-cream outline-none focus:border-gold/60"
            value=""
            onChange={(e) => add(e.target.value)}
            aria-label="إضافة سواق"
          >
            <option value="">+ إضافة سواق…</option>
            {(all.data ?? [])
              .filter((d) => !ids.includes(d.id))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
          {save.error && <ErrorWithBookings error={save.error} />}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-muted">لو العميل ما اختارش سواق، الأساسي بيتجرّب الأول.</span>
            <Button variant="primary" size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "…" : "حفظ السواقين"}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

// -------------------------------------------------------------- maintenance
function Maintenance({ car, canEdit }: { car: FleetDetail; canEdit: boolean }) {
  const qc = useQueryClient();
  const today = todayKey();
  const [form, setForm] = useState({ maintenanceType: "", startDate: today, endDate: today, cost: "", notes: "" });
  const valid = form.maintenanceType.trim() && form.startDate && form.endDate >= form.startDate && (form.cost === "" || Number(form.cost) >= 0);
  const schedule = useMutation({
    mutationFn: () =>
      api.post(`/admin/vehicles/${car.id}/maintenance`, {
        maintenanceType: form.maintenanceType.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        cost: form.cost === "" ? 0 : Number(form.cost),
        ...(form.notes.trim() && { notes: form.notes.trim() }),
      }),
    onSuccess: () => {
      setForm({ maintenanceType: "", startDate: today, endDate: today, cost: "", notes: "" });
      invalidateFleet(qc, car.id);
    },
  });
  const complete = useMutation({ mutationFn: (id: string) => api.patch(`/admin/maintenance/${id}/complete`, {}), onSuccess: () => invalidateFleet(qc, car.id) });
  const cancel = useMutation({ mutationFn: (id: string) => api.del(`/admin/maintenance/${id}`), onSuccess: () => invalidateFleet(qc, car.id) });

  return (
    <Panel title="الصيانة" tag="العربية ما بتتحجزش في أيام الصيانة" bodyClassName="flex flex-col gap-4">
      {canEdit && car.status !== "RETIRED" && (
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) schedule.mutate();
          }}
        >
          <Field label="نوع الصيانة">
            <input className={fieldControl} list="maintenance-types" value={form.maintenanceType} onChange={(e) => setForm({ ...form, maintenanceType: e.target.value })} placeholder="صيانة دورية" aria-label="نوع الصيانة" />
            <datalist id="maintenance-types">
              {MAINTENANCE_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="التكلفة المتوقعة (ج.م)">
            <input className={cx(fieldControl, "ltr text-right")} inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="0" aria-label="التكلفة" />
          </Field>
          <Field label="من يوم">
            <input type="date" className={cx(fieldControl, "ltr text-right")} min={today} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: form.endDate < e.target.value ? e.target.value : form.endDate })} aria-label="من يوم" />
          </Field>
          <Field label="لحد يوم">
            <input type="date" className={cx(fieldControl, "ltr text-right")} min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} aria-label="لحد يوم" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="ملاحظات (اختياري)">
              <input className={fieldControl} value={form.notes} maxLength={500} onChange={(e) => setForm({ ...form, notes: e.target.value })} aria-label="ملاحظات الصيانة" />
            </Field>
          </div>
          {schedule.error && (
            <div className="sm:col-span-2">
              <ErrorWithBookings error={schedule.error} />
            </div>
          )}
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" variant="primary" disabled={!valid || schedule.isPending}>
              <Wrench className="size-4" /> {schedule.isPending ? "…" : "تسجيل الصيانة"}
            </Button>
          </div>
        </form>
      )}

      {(complete.error || cancel.error) && <ErrorBox error={msg(complete.error ?? cancel.error)} />}
      {car.maintenance.length === 0 ? (
        <Empty>مفيش صيانة متسجّلة للعربية دي.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {car.maintenance.map((m) => {
            const st = MAINTENANCE_STATE[m.state];
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span className="text-[14px] font-bold text-cream">
                    {m.type} <Badge tone={st.tone}>{st.label}</Badge>
                  </span>
                  <span className="text-[13px] text-muted">
                    {dayMonth(m.startDate)}
                    {m.endDate !== m.startDate && ` → ${dayMonth(m.endDate)}`}
                    {m.cost > 0 && ` · ${egp(m.cost)}`}
                    {m.notes && ` · ${m.notes}`}
                  </span>
                </div>
                {canEdit && m.state !== "DONE" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => complete.mutate(m.id)} disabled={complete.isPending}>
                      ✓ خلصت
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => cancel.mutate(m.id)} disabled={cancel.isPending}>
                      إلغاء
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// -------------------------------------------------------- retire / restore
function ServiceStatus({ car, canEdit }: { car: FleetDetail; canEdit: boolean }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const retire = useMutation({ mutationFn: () => api.post(`/admin/vehicles/${car.id}/retire`, reason.trim() ? { reason: reason.trim() } : {}), onSuccess: () => invalidateFleet(qc, car.id) });
  const restore = useMutation({ mutationFn: () => api.post(`/admin/vehicles/${car.id}/reactivate`, {}), onSuccess: () => invalidateFleet(qc, car.id) });
  if (!canEdit) return null;
  return car.retiredAt ? (
    <Panel title="العربية موقوفة" bodyClassName="flex flex-col gap-3">
      <p className="text-[14px] text-muted">
        مش ظاهرة للعملاء ولا بتتحجز{car.retiredReason ? ` · السبب: ${car.retiredReason}` : ""}. سجلها وحجوزاتها القديمة محفوظين.
      </p>
      {restore.error && <ErrorBox error={msg(restore.error)} />}
      <Button variant="primary" onClick={() => restore.mutate()} disabled={restore.isPending}>
        إعادة تشغيل العربية
      </Button>
    </Panel>
  ) : (
    <Panel title="إيقاف العربية" bodyClassName="flex flex-col gap-3">
      <p className="text-[13px] text-muted">بدل الحذف: بتختفي من التطبيق والحجوزات الجديدة، وتاريخها بيفضل. تقدر ترجّعها في أي وقت.</p>
      <input
        className="rounded-xl border border-line bg-raised px-3 py-2 text-[14px] text-cream outline-none focus:border-gold/60"
        placeholder="السبب (اختياري): اتباعت، حادثة…"
        value={reason}
        maxLength={200}
        onChange={(e) => setReason(e.target.value)}
        aria-label="سبب الإيقاف"
      />
      {retire.error && <ErrorWithBookings error={retire.error} />}
      <Button variant="danger" onClick={() => retire.mutate()} disabled={retire.isPending}>
        إيقاف العربية
      </Button>
    </Panel>
  );
}

// --------------------------------------------------------------------- page
export default function FleetVehicle() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const canEdit = canManageFleet(me);
  const isNew = id === "new";
  const q = useQuery({ queryKey: ["fleet-car", id], queryFn: () => api.get<FleetDetail>(`/admin/vehicles/${id}`), enabled: !isNew });
  const car = q.data;

  if (isNew) {
    return (
      <Page width="medium">
        <PageHeader back="/fleet" eyebrow="الأسطول" title="إضافة عربية" />
        {!canEdit ? (
          <ErrorBox error="معندكش صلاحية تضيف عربيات." />
        ) : (
          <>
            <p className="text-[14px] text-muted">بعد الإضافة هتقدر ترفع الصور وتحدد السواقين والصيانة.</p>
            <DetailsForm canEdit onCreated={(newId) => navigate(`/fleet/${newId}`, { replace: true })} />
          </>
        )}
      </Page>
    );
  }

  const st = car && FLEET_STATUS[car.status];
  return (
    <Page>
      <PageHeader
        back="/fleet"
        eyebrow="الأسطول"
        title={car ? car.name : "…"}
        actions={
          car &&
          st && (
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
              <Badge tone={st.tone} dot>
                {st.label}
              </Badge>
              <span>{car.stats.completedTrips} رحلة مكتملة</span>
              <span>· إيراد {egp(car.stats.revenue)}</span>
            </div>
          )
        }
      />
      {q.error && <ErrorBox error={msg(q.error)} onRetry={() => q.refetch()} />}
      {!car ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 rounded-[18px] lg:col-span-2" />
          <Skeleton className="h-96 rounded-[18px]" />
        </div>
      ) : (
        <>
          {!canEdit && <div className="rounded-xl border border-line bg-raised px-4 py-3 text-[14px] text-muted">للعرض بس. تعديل الأسطول محتاج صلاحية vehicle:manage.</div>}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-2">
              <DetailsForm car={car} canEdit={canEdit} />
              <Photos car={car} canEdit={canEdit} />
              <Maintenance car={car} canEdit={canEdit} />
            </div>
            <div className="flex flex-col gap-4">
              <Drivers car={car} canEdit={canEdit} />
              <Panel title="الحجوزات الجاية" tag={car.upcomingBookings.length ? `أول ${car.upcomingBookings.length}` : undefined}>
                {car.upcomingBookings.length === 0 ? (
                  <Empty>مفيش حجوزات جاية.</Empty>
                ) : (
                  <ul className="flex flex-col">
                    {car.upcomingBookings.map((b) => (
                      <li key={b.id} className="border-b border-line py-2 last:border-b-0">
                        <Link to={`/day/${b.bookingDate}?booking=${b.id}`} className="flex items-center justify-between gap-2 text-[14px] hover:text-gold">
                          <span className="text-cream">
                            {dayMonth(b.bookingDate)} · {time12(b.startTime)}
                          </span>
                          <span className="truncate text-muted">{b.customer?.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <ServiceStatus car={car} canEdit={canEdit} />
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
