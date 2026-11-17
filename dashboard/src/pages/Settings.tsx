import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { VEHICLE_CATEGORY } from "../lib/labels";
import type { BusinessSettings, CategoryRate, SettingsResponse } from "../lib/types";
import { Button, ErrorBox, Field, Page, PageHeader, Panel, Skeleton, Table, Td, fieldControl } from "../components/ui";

type NumKey = Exclude<keyof BusinessSettings, "categoryRates">;

interface FieldDef {
  key: NumKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  int?: boolean;
  help: string;
}

/** Same ranges as the API (services/settings.service.ts). */
const GROUPS: { title: string; tag: string; fields: FieldDef[] }[] = [
  {
    title: "الحجز والدفع",
    tag: "بيسري على الحجوزات الجديدة",
    fields: [
      { key: "depositRate", label: "نسبة العربون", unit: "%", min: 0, max: 100, help: "من إجمالي سعر الرحلة. الحجز بيتأكد لوحده لما العربون يتدفع." },
      { key: "bookingBufferMinutes", label: "الفاصل بين رحلتين", unit: "دقيقة", min: 0, max: 720, int: true, help: "أقل وقت فاضي لازم يكون بين رحلتين لنفس العربية أو السائق." },
      { key: "tripEarlyStartMinutes", label: "السائق يبدأ الرحلة قبل ميعادها بـ", unit: "دقيقة", min: 0, max: 1440, int: true, help: "أقصى وقت يقدر السائق يبدأ فيه الرحلة قبل ميعادها." },
    ],
  },
  {
    title: "الفلوس",
    tag: "عمولة وإحالة وذروة",
    fields: [
      { key: "defaultCommissionRate", label: "عمولة الشركة للسائق الجديد", unit: "%", min: 0, max: 100, help: "بتتحط للسائقين اللي بيتسجلوا بعد التغيير. عمولة كل سائق حالي بتتعدل من صفحته." },
      { key: "referralRewardAmount", label: "مكافأة الإحالة", unit: "ج.م", min: 0, max: 1_000_000, help: "رصيد بيتضاف لصاحب الكود لما أول رحلة للعميل اللي دعاه تخلص." },
      { key: "referredDiscountAmount", label: "خصم العميل المدعو على أول حجز", unit: "ج.م", min: 0, max: 1_000_000, help: "بيتخصم تلقائي من أول حجز للعميل اللي سجّل بكود إحالة. 0 = مفيش خصم." },
      { key: "peakSurgeMultiplier", label: "مضاعف سعر وقت الذروة", unit: "×", min: 1, max: 5, help: "مثلاً 1.25 يعني السعر بيزيد 25% في وقت الذروة." },
    ],
  },
  {
    title: "تنبيهات اللوحة",
    tag: "بتأثر على العرض بس",
    fields: [
      { key: "vipSpendThreshold", label: "العميل يبقى VIP لما يصرف", unit: "ج.م", min: 0, max: 1_000_000, help: "إجمالي اللي صرفه العميل من أول ما سجّل." },
      { key: "delayAlertMinutes", label: "تنبيه تأخير الرحلة الجارية بعد", unit: "دقيقة", min: 1, max: 240, int: true, help: "الرحلة بتظهر متأخرة في الرحلات الجارية لما تعدّي الوقت ده." },
      { key: "punctualityGraceMinutes", label: "سماحية التأخير في بدء الرحلة", unit: "دقيقة", min: 0, max: 240, int: true, help: "لو السائق بدأ بعد الميعاد بأكتر من كده، الرحلة بتتحسب متأخرة في نسبة الالتزام." },
      { key: "complaintMaxRating", label: "التقييم يتحسب شكوى لو", unit: "نجوم أو أقل", min: 1, max: 4, int: true, help: "التقييمات دي بتظهر في الشكاوى والتنبيهات." },
      { key: "maintenanceAlertDays", label: "تنبيه الصيانة قبلها بـ", unit: "يوم", min: 1, max: 90, int: true, help: "العربيات اللي صيانتها قربت بتظهر في التنبيهات." },
    ],
  },
];

const RATE_FIELDS: { key: keyof CategoryRate; label: string }[] = [
  { key: "basePrice", label: "سعر فتح الرحلة" },
  { key: "pricePerKm", label: "سعر الكيلو" },
  { key: "pricePerHour", label: "سعر الساعة" },
];

type Form = Record<NumKey, string>;
type RatesForm = Record<string, Record<keyof CategoryRate, string>>;

const toForm = (s: BusinessSettings): Form =>
  Object.fromEntries(GROUPS.flatMap((g) => g.fields).map((f) => [f.key, String(s[f.key])])) as Form;

const toRatesForm = (s: BusinessSettings): RatesForm =>
  Object.fromEntries(
    Object.entries(s.categoryRates).map(([cat, r]) => [cat, { basePrice: String(r.basePrice), pricePerKm: String(r.pricePerKm), pricePerHour: String(r.pricePerHour) }])
  );

const parse = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(",", ".")));

function validate(f: FieldDef, raw: string): string | null {
  const n = parse(raw);
  if (!Number.isFinite(n)) return "اكتب رقم";
  if (f.int && !Number.isInteger(n)) return "رقم صحيح من غير كسور";
  if (n < f.min || n > f.max) return `بين ${f.min} و ${f.max.toLocaleString("en")}`;
  return null;
}

export default function Settings() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const canEdit = me?.role?.name === "SUPER_ADMIN" || !!me?.role?.permissions?.includes("settings:manage");

  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<SettingsResponse>("/admin/settings") });
  const [form, setForm] = useState<Form | null>(null);
  const [rates, setRates] = useState<RatesForm | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (q.data && !form) {
      setForm(toForm(q.data));
      setRates(toRatesForm(q.data));
    }
  }, [q.data, form]);

  const fields = GROUPS.flatMap((g) => g.fields);
  const errors = useMemo(() => {
    if (!form) return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const f of fields) {
      const e = validate(f, form[f.key]);
      if (e) out[f.key] = e;
    }
    for (const [cat, r] of Object.entries(rates ?? {})) {
      for (const rf of RATE_FIELDS) {
        const n = parse(r[rf.key]);
        if (!Number.isFinite(n) || n < 0) out[`${cat}.${rf.key}`] = "رقم موجب";
      }
    }
    return out;
  }, [form, rates]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Only the values that differ from what is saved. */
  const changes = useMemo(() => {
    if (!form || !rates || !q.data) return null;
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const n = parse(form[f.key]);
      if (Number.isFinite(n) && n !== q.data[f.key]) body[f.key] = n;
    }
    const changedRates: Record<string, CategoryRate> = {};
    for (const [cat, r] of Object.entries(rates)) {
      const next = { basePrice: parse(r.basePrice), pricePerKm: parse(r.pricePerKm), pricePerHour: parse(r.pricePerHour) };
      const cur = q.data.categoryRates[cat];
      if (!cur || RATE_FIELDS.some((rf) => next[rf.key] !== cur[rf.key])) changedRates[cat] = next;
    }
    if (Object.keys(changedRates).length) body.categoryRates = changedRates;
    return body;
  }, [form, rates, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeCount = changes ? Object.keys(changes).filter((k) => k !== "categoryRates").length + Object.keys((changes.categoryRates as object) ?? {}).length : 0;
  const hasErrors = Object.keys(errors).length > 0;

  const save = useMutation({
    mutationFn: () => api.put<SettingsResponse>("/admin/settings", changes),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      setForm(toForm(data));
      setRates(toRatesForm(data));
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["audit"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  useEffect(() => {
    if (changeCount > 0) setSaved(false);
  }, [changeCount]);

  const discard = () => {
    if (!q.data) return;
    setForm(toForm(q.data));
    setRates(toRatesForm(q.data));
    save.reset();
  };

  const actions = canEdit && (
    <>
      {saved && changeCount === 0 && <span className="fade-in text-[11px] text-mint">اتحفظ ✓</span>}
      {changeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={discard} disabled={save.isPending}>
          إلغاء التغييرات
        </Button>
      )}
      <Button variant="primary" onClick={() => save.mutate()} disabled={changeCount === 0 || hasErrors || save.isPending}>
        {save.isPending ? "بيحفظ…" : changeCount > 0 ? `حفظ (${changeCount})` : "حفظ"}
      </Button>
    </>
  );

  return (
    <Page>
      <PageHeader back="/" eyebrow="Super Admin" title="الإعدادات" actions={actions} />

      {q.error && <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {save.error && <ErrorBox error={errorMessage(save.error)} />}
      {!canEdit && q.data && (
        <div className="rounded-xl border border-line bg-raised px-4 py-3 text-[12px] text-muted">
          للعرض بس. تعديل الإعدادات محتاج صلاحية <span dir="ltr">settings:manage</span> (الـ Super Admin عنده الصلاحية دي).
        </div>
      )}

      {!form || !rates || !q.data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-[18px]" />)}</div>
      ) : (
        <>
          <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-3">
            {GROUPS.map((g) => (
              <Panel key={g.title} title={g.title} tag={g.tag} bodyClassName="flex flex-col gap-3">
                {g.fields.map((f) => {
                  const changed = changes && f.key in changes;
                  const def = q.data!.defaults[f.key];
                  return (
                    <div key={f.key} className="flex flex-col gap-1">
                      <Field
                        label={
                          <span className="flex items-center justify-between gap-2">
                            <span>{f.label}</span>
                            {changed && <span className="text-gold">● متغيّر</span>}
                          </span>
                        }
                        hint={errors[f.key]}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            className={`${fieldControl} ltr text-right`}
                            inputMode="decimal"
                            value={form[f.key]}
                            disabled={!canEdit}
                            aria-label={f.label}
                            aria-invalid={!!errors[f.key]}
                            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                          />
                          <span className="shrink-0 text-[11px] text-muted">{f.unit}</span>
                        </span>
                      </Field>
                      <p className="px-1 text-[10.5px] leading-relaxed text-muted">
                        {f.help} <span className="text-muted/70">الأصلي: {def.toLocaleString("en")}</span>
                      </p>
                    </div>
                  );
                })}
              </Panel>
            ))}
          </div>

          <Panel title="الأسعار حسب نوع العربية" tag="بالجنيه · لو العربية ليها سعر خاص بيها بيتحسب هو">
            <Table head={["النوع", ...RATE_FIELDS.map((r) => r.label)]}>
              {Object.keys(rates).map((cat) => (
                <tr key={cat}>
                  <Td className="font-bold">
                    {VEHICLE_CATEGORY[cat] ?? cat} <span className="text-[10px] font-normal text-muted" dir="ltr">{cat}</span>
                  </Td>
                  {RATE_FIELDS.map((rf) => {
                    const k = `${cat}.${rf.key}`;
                    const cur = q.data!.categoryRates[cat]?.[rf.key];
                    const changed = parse(rates[cat][rf.key]) !== cur;
                    return (
                      <Td key={rf.key}>
                        <input
                          className={`ltr w-24 rounded-lg border bg-raised px-2 py-1.5 text-right text-[12px] font-bold text-cream outline-none focus:border-gold/60 ${errors[k] ? "border-wine" : changed ? "border-gold/70" : "border-line"}`}
                          inputMode="decimal"
                          value={rates[cat][rf.key]}
                          disabled={!canEdit}
                          aria-label={`${VEHICLE_CATEGORY[cat] ?? cat} ${rf.label}`}
                          onChange={(e) => setRates({ ...rates, [cat]: { ...rates[cat], [rf.key]: e.target.value } })}
                        />
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </Table>
          </Panel>

          <p className="text-[11px] leading-relaxed text-muted">
            التغيير بيسري على الحجوزات الجديدة بس. الحجوزات الموجودة بتفضل بسعرها وعربونها. كل تعديل بيتسجل في سجل التوثيق.
          </p>
        </>
      )}
    </Page>
  );
}
