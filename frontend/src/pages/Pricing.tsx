import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { VEHICLE_CATEGORY } from "../lib/labels";
import { egp, num } from "../lib/format";
import type { Destination, FleetItem, SettingsResponse, VehicleCategory } from "../lib/types";
import { Badge, Button, Chips, cx, Empty, ErrorBox, Field, fieldControl, Page, PageHeader, Panel, Skeleton } from "../components/ui";
import { PlacePickerDialog } from "../components/PlacePicker";

type Tab = "WEDDING" | "TRIP" | "VIP";
const CATEGORIES = Object.keys(VEHICLE_CATEGORY) as VehicleCategory[];

const parse = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(",", ".")));
const isPrice = (v: string) => Number.isFinite(parse(v)) && parse(v) >= 0;

/** A number input that sits inside a Field. */
function NumInput({ value, onChange, disabled, label, placeholder }: { value: string; onChange: (v: string) => void; disabled?: boolean; label: string; placeholder?: string }) {
  return (
    <input
      className={cx(fieldControl, "ltr text-right")}
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={label}
      placeholder={placeholder}
    />
  );
}

/** Saves only the settings fields that changed. */
function useSettingsSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<SettingsResponse>("/admin/settings", body),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      qc.invalidateQueries({ queryKey: ["audit"] });
      qc.invalidateQueries({ queryKey: ["fleet"] });
      qc.invalidateQueries({ queryKey: ["pricing-catalog"] });
    },
  });
}

/**
 * Prices by service type: wedding (fixed per car), private trips (fixed per
 * destination and car type, from the company), VIP (fixed per car). Each with
 * what the price covers and the price of every extra hour / km.
 */
export default function Pricing() {
  const { me } = useAuth();
  const canEdit = me?.role?.name === "SUPER_ADMIN" || !!me?.role?.permissions?.includes("settings:manage");
  const [tab, setTab] = useState<Tab>("WEDDING");
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<SettingsResponse>("/admin/settings") });
  const fleet = useQuery({ queryKey: ["fleet", ""], queryFn: () => api.raw<{ data: FleetItem[] }>("GET", "/admin/vehicles").then((r) => r.data) });
  const cars = (fleet.data ?? []).filter((v) => v.status !== "RETIRED");

  return (
    <Page>
      <PageHeader eyebrow="زفاف، مشاوير خاصة، VIP" title="الأسعار" />
      <Chips
        label="نوع الخدمة"
        value={tab}
        onChange={setTab}
        options={[
          { value: "WEDDING", label: "الزفاف" },
          { value: "TRIP", label: "المشاوير الخاصة" },
          { value: "VIP", label: "VIP" },
        ]}
      />
      {!canEdit && (
        <div className="rounded-xl border border-line bg-raised px-4 py-3 text-[14px] text-muted">
          للعرض بس. تعديل الأسعار محتاج صلاحية <span dir="ltr">settings:manage</span> (الـ Super Admin عنده الصلاحية دي).
        </div>
      )}
      {settings.error && <ErrorBox error={errorMessage(settings.error)} onRetry={() => settings.refetch()} />}
      {!settings.data ? (
        <Skeleton className="h-80 rounded-[18px]" />
      ) : tab === "TRIP" ? (
        <TripTab s={settings.data} cars={cars} canEdit={canEdit} />
      ) : (
        <OccasionTab key={tab} kind={tab} s={settings.data} cars={cars} loadingCars={fleet.isPending} canEdit={canEdit} />
      )}
    </Page>
  );
}

// ------------------------------------------------------------ wedding / VIP
function OccasionTab({ kind, s, cars, loadingCars, canEdit }: { kind: "WEDDING" | "VIP"; s: SettingsResponse; cars: FleetItem[]; loadingCars: boolean; canEdit: boolean }) {
  const p = kind === "WEDDING" ? "wedding" : "vip";
  const keys = [`${p}DefaultPrice`, `${p}IncludedHours`, `${p}IncludedKm`, `${p}ExtraHourPrice`, `${p}ExtraKmPrice`] as const;
  const labels = ["السعر العام (لأي عربية مالهاش سعر)", "الساعات المشمولة", "الكيلومترات المشمولة", "سعر كل ساعة زيادة", "سعر كل كيلو زيادة"];
  const units = ["ج.م", "ساعة", "كم", "ج.م", "ج.م"];
  const initial = useMemo(() => Object.fromEntries(keys.map((k) => [k, String((s as unknown as Record<string, number>)[k])])), [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState<Record<string, string>>(initial);
  useEffect(() => setF(initial), [initial]);
  const save = useSettingsSave();
  const changed = keys.filter((k) => parse(f[k]) !== parse(initial[k]));
  const bad = keys.some((k) => !isPrice(f[k]) || ((k.endsWith("Hours") || k.endsWith("Km")) && !Number.isInteger(parse(f[k]))));
  const v = (k: (typeof keys)[number]) => parse(f[k]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Panel title={kind === "WEDDING" ? "قواعد سعر الزفاف" : "قواعد سعر VIP"} tag="سعر ثابت للعربية" bodyClassName="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {keys.map((k, i) => (
            <Field key={k} label={`${labels[i]} (${units[i]})`}>
              <NumInput value={f[k]} onChange={(x) => setF({ ...f, [k]: x })} disabled={!canEdit} label={labels[i]} />
            </Field>
          ))}
        </div>
        {!bad && (
          <p className="rounded-xl bg-raised px-3 py-2.5 text-[13px] leading-relaxed text-muted">
            مثال: عربية بالسعر العام، الحجز {num(v(keys[1]) + 2)} ساعات و{num(v(keys[2]) + 10)} كم ={" "}
            {egp(v(keys[0]))} + ساعتين × {egp(v(keys[3]))} + 10 كم × {egp(v(keys[4]))} ={" "}
            <b className="text-cream">{egp(v(keys[0]) + 2 * v(keys[3]) + 10 * v(keys[4]))}</b>
          </p>
        )}
        {save.error && <ErrorBox error={errorMessage(save.error)} />}
        {canEdit && (
          <div className="flex items-center justify-end gap-2">
            {save.isSuccess && changed.length === 0 && <span className="fade-in text-[13px] text-mint">اتحفظ ✓</span>}
            <Button variant="primary" disabled={!changed.length || bad || save.isPending} onClick={() => save.mutate(Object.fromEntries(changed.map((k) => [k, parse(f[k])])))}>
              {save.isPending ? "بيحفظ…" : "حفظ القواعد"}
            </Button>
          </div>
        )}
      </Panel>

      <Panel title="سعر كل عربية" tag="فاضية = السعر العام" bodyClassName="flex flex-col">
        {loadingCars ? (
          <Skeleton className="h-48" />
        ) : cars.length === 0 ? (
          <Empty>مفيش عربيات في الأسطول لسه.</Empty>
        ) : (
          <ul className="flex flex-col">
            {cars.map((c) => (
              <CarPriceRow key={c.id} car={c} kind={kind} fallback={v(keys[0])} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function CarPriceRow({ car, kind, fallback, canEdit }: { car: FleetItem; kind: "WEDDING" | "VIP"; fallback: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const field = kind === "WEDDING" ? "weddingPrice" : "vipPrice";
  const current = car[field];
  const [val, setVal] = useState(current == null ? "" : String(current));
  useEffect(() => setVal(current == null ? "" : String(current)), [current]);
  const save = useMutation({
    mutationFn: () => api.patch(`/admin/vehicles/${car.id}`, { [field]: val.trim() === "" ? null : parse(val) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fleet"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
  const dirty = (val.trim() === "" ? null : parse(val)) !== current;
  const invalid = val.trim() !== "" && !isPrice(val);
  return (
    <li className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold text-cream">{car.name}</div>
        <div className="text-[12px] text-muted">
          {VEHICLE_CATEGORY[car.category]} · {car.year}
        </div>
      </div>
      <label className={cx("flex w-[150px] items-center gap-1 rounded-xl border bg-raised px-3 py-2", invalid ? "border-wine" : "border-line focus-within:border-gold/60")}>
        <input
          className="ltr w-full bg-transparent text-right text-[14px] font-bold text-cream outline-none placeholder:font-normal placeholder:text-muted/70"
          inputMode="decimal"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={num(fallback)}
          disabled={!canEdit}
          aria-label={`سعر ${kind === "WEDDING" ? "الزفاف" : "VIP"} لـ ${car.name}`}
        />
        <span className="text-[12px] text-muted">ج.م</span>
      </label>
      <div className="w-[72px] text-left">
        {dirty && canEdit ? (
          <Button size="sm" variant="primary" disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            حفظ
          </Button>
        ) : current == null ? (
          <Badge tone="muted">العام</Badge>
        ) : save.isSuccess ? (
          <span className="text-[12px] text-mint">اتحفظ ✓</span>
        ) : null}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------- trips
function TripTab({ s, cars, canEdit }: { s: SettingsResponse; cars: FleetItem[]; canEdit: boolean }) {
  const save = useSettingsSave();
  const [rules, setRules] = useState({ tripIncludedKm: String(s.tripIncludedKm), tripExtraKmPrice: String(s.tripExtraKmPrice) });
  const [other, setOther] = useState<Record<string, string>>(() => Object.fromEntries(CATEGORIES.map((c) => [c, String(s.tripOtherPrices[c])])));
  const [picking, setPicking] = useState<"origin" | "destination" | null>(null);
  const qc = useQueryClient();
  const dests = useQuery({ queryKey: ["destinations"], queryFn: () => api.get<Destination[]>("/admin/destinations") });
  const create = useMutation({
    mutationFn: (p: { latitude: number; longitude: number; label: string }) =>
      api.post("/admin/destinations", { name: p.label.split("،")[0].trim().slice(0, 120) || p.label.slice(0, 120), latitude: p.latitude, longitude: p.longitude }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["destinations"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
  // Show the car types the fleet actually has, plus any already priced.
  const shown = CATEGORIES.filter((c) => cars.some((v) => v.category === c) || (dests.data ?? []).some((d) => d.prices[c] != null));
  const cats = shown.length ? shown : CATEGORIES;

  const ruleChanges = Object.fromEntries(Object.entries(rules).filter(([k, v]) => parse(v) !== (s as unknown as Record<string, number>)[k]).map(([k, v]) => [k, parse(v)]));
  const otherChanges = Object.fromEntries(Object.entries(other).filter(([c, v]) => parse(v) !== s.tripOtherPrices[c as VehicleCategory]).map(([c, v]) => [c, parse(v)]));
  const bad = !Number.isInteger(parse(rules.tripIncludedKm)) || !isPrice(rules.tripIncludedKm) || !isPrice(rules.tripExtraKmPrice) || Object.values(other).some((v) => !isPrice(v));
  const changeCount = Object.keys(ruleChanges).length + Object.keys(otherChanges).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="قواعد المشوار" tag="من نقطة البداية للوجهة" bodyClassName="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[12px] text-muted">المشاوير بتبدأ من</div>
              <div className="truncate text-[15px] font-bold text-cream">{s.originLabel}</div>
            </div>
            {canEdit && (
              <Button size="sm" onClick={() => setPicking("origin")}>
                <MapPin className="size-4" /> غيّر
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="الكيلومترات المشمولة في سعر الوجهة (كم)">
              <NumInput value={rules.tripIncludedKm} onChange={(v) => setRules({ ...rules, tripIncludedKm: v })} disabled={!canEdit} label="الكيلومترات المشمولة" />
            </Field>
            <Field label="سعر كل كيلو زيادة (ج.م)">
              <NumInput value={rules.tripExtraKmPrice} onChange={(v) => setRules({ ...rules, tripExtraKmPrice: v })} disabled={!canEdit} label="سعر الكيلو الزيادة" />
            </Field>
          </div>
          <p className="text-[12px] text-muted">أي وجهة تقدر تحدد لها عدد كيلومترات مختلف من الجدول تحت (مثلًا إسكندرية 300 كم).</p>
        </Panel>

        <Panel title="مشوار لمكان مش في القايمة" tag="سعر حسب نوع العربية" bodyClassName="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {CATEGORIES.map((c) => (
              <Field key={c} label={`${VEHICLE_CATEGORY[c]} (ج.م)`}>
                <NumInput value={other[c]} onChange={(v) => setOther({ ...other, [c]: v })} disabled={!canEdit} label={`سعر المشوار لمكان تاني ${VEHICLE_CATEGORY[c]}`} />
              </Field>
            ))}
          </div>
          <p className="text-[12px] text-muted">وبيتحسب عليه نفس الكيلومترات المشمولة والزيادة. ده كمان السعر لأي نوع عربية مالوش سعر في وجهة من القايمة.</p>
        </Panel>
      </div>
      {save.error && <ErrorBox error={errorMessage(save.error)} />}
      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          {save.isSuccess && changeCount === 0 && <span className="fade-in text-[13px] text-mint">اتحفظ ✓</span>}
          <Button
            variant="primary"
            disabled={!changeCount || bad || save.isPending}
            onClick={() => save.mutate({ ...ruleChanges, ...(Object.keys(otherChanges).length && { tripOtherPrices: otherChanges }) })}
          >
            {save.isPending ? "بيحفظ…" : changeCount ? `حفظ (${changeCount})` : "حفظ"}
          </Button>
        </div>
      )}

      <Panel
        title="الوجهات"
        tag={dests.data ? `${dests.data.filter((d) => d.active).length} وجهة` : undefined}
        bodyClassName="flex flex-col gap-3"
      >
        {dests.error && <ErrorBox error={errorMessage(dests.error)} onRetry={() => dests.refetch()} />}
        {create.error && <ErrorBox error={errorMessage(create.error)} />}
        {dests.isPending ? (
          <Skeleton className="h-40" />
        ) : (dests.data ?? []).length === 0 ? (
          <Empty>مفيش وجهات لسه. ضيف المطار والقاهرة وأي مشوار متكرر بسعره.</Empty>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-right">
              <thead>
                <tr className="text-[12px] text-muted">
                  <th className="border-b border-line px-1.5 py-2 font-normal">الوجهة</th>
                  <th className="border-b border-line px-1.5 py-2 font-normal">كم مشمولة</th>
                  {cats.map((c) => (
                    <th key={c} className="border-b border-line px-1.5 py-2 font-normal">{VEHICLE_CATEGORY[c]}</th>
                  ))}
                  <th className="border-b border-line px-1.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {(dests.data ?? []).map((d) => (
                  <DestinationRow key={d.id} d={d} cats={cats} canEdit={canEdit} fallbackKm={s.tripIncludedKm} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div>
            <Button onClick={() => setPicking("destination")} disabled={create.isPending}>
              <Plus className="size-4" /> إضافة وجهة من الخريطة
            </Button>
          </div>
        )}
      </Panel>

      {picking && (
        <PlacePickerDialog
          which={picking === "origin" ? "from" : "to"}
          initial={picking === "origin" ? { latitude: s.originLat, longitude: s.originLng, label: s.originLabel } : null}
          other={picking === "destination" ? { latitude: s.originLat, longitude: s.originLng, label: s.originLabel } : null}
          onClose={() => setPicking(null)}
          onPick={(p) => {
            if (picking === "origin") save.mutate({ originLabel: p.label.slice(0, 200), originLat: p.latitude, originLng: p.longitude });
            else create.mutate(p);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function DestinationRow({ d, cats, canEdit, fallbackKm }: { d: Destination; cats: VehicleCategory[]; canEdit: boolean; fallbackKm: number }) {
  const qc = useQueryClient();
  const init = useMemo(
    () => ({ name: d.name, includedKm: d.includedKm == null ? "" : String(d.includedKm), ...Object.fromEntries(cats.map((c) => [c, d.prices[c] == null ? "" : String(d.prices[c])])) }),
    [d, cats]
  ) as Record<string, string>;
  const [f, setF] = useState(init);
  useEffect(() => setF(init), [init]);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["destinations"] });
    qc.invalidateQueries({ queryKey: ["audit"] });
  };
  const save = useMutation({
    mutationFn: () => {
      const prices = Object.fromEntries(cats.filter((c) => f[c].trim() !== "").map((c) => [c, parse(f[c])]));
      return api.patch(`/admin/destinations/${d.id}`, { name: f.name.trim(), includedKm: f.includedKm.trim() === "" ? null : parse(f.includedKm), prices });
    },
    onSuccess: done,
  });
  const toggle = useMutation({ mutationFn: () => api.patch(`/admin/destinations/${d.id}`, { active: !d.active }), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api.del(`/admin/destinations/${d.id}`), onSuccess: done });
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const bad = f.name.trim().length < 2 || cats.some((c) => f[c].trim() !== "" && !isPrice(f[c])) || (f.includedKm.trim() !== "" && !Number.isInteger(parse(f.includedKm)));
  const cell = "border-b border-line px-1.5 py-2";
  const inputCls = "ltr w-full min-w-[70px] rounded-lg border border-line bg-raised px-2 py-1.5 text-right text-[13px] font-bold text-cream outline-none focus:border-gold/60 placeholder:font-normal placeholder:text-muted/70";
  return (
    <tr className={cx(!d.active && "opacity-50")}>
      <td className={cell}>
        <input className={cx(inputCls, "rtl min-w-[140px] text-right")} dir="rtl" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!canEdit} aria-label="اسم الوجهة" />
        {d.bookings > 0 && <div className="mt-0.5 text-[11px] text-muted">{num(d.bookings)} حجز</div>}
      </td>
      <td className={cell}>
        <input className={inputCls} inputMode="numeric" value={f.includedKm} onChange={(e) => setF({ ...f, includedKm: e.target.value })} placeholder={num(fallbackKm)} disabled={!canEdit} aria-label={`كيلومترات ${d.name}`} />
      </td>
      {cats.map((c) => (
        <td key={c} className={cell}>
          <input className={inputCls} inputMode="decimal" value={f[c]} onChange={(e) => setF({ ...f, [c]: e.target.value })} placeholder={num(d.effectivePrices[c])} disabled={!canEdit} aria-label={`سعر ${d.name} ${VEHICLE_CATEGORY[c]}`} />
        </td>
      ))}
      <td className={cn(cell, "whitespace-nowrap")}>
        {canEdit && (
          <div className="flex items-center gap-1">
            {dirty ? (
              <Button size="sm" variant="primary" disabled={bad || save.isPending} onClick={() => save.mutate()}>
                حفظ
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
                {d.active ? "إيقاف" : "تشغيل"}
              </Button>
            )}
            {d.bookings === 0 && (
              <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-wine/15 hover:text-rose" onClick={() => remove.mutate()} aria-label={`مسح ${d.name}`}>
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

const cn = cx;
