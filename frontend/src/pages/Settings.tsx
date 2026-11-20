import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { BusinessSettings, SettingsResponse } from "../lib/types";
import { Button, cx, ErrorBox, Field, Page, PageHeader, Panel, Skeleton, fieldControl } from "../components/ui";

type NumKey = Exclude<keyof BusinessSettings, "tripOtherPrices" | "originLabel">;

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
      { key: "minTripMinutes", label: "أقل مدة للرحلة", unit: "دقيقة", min: 0, max: 720, int: true, help: "الحجز اللي أقصر من كده بيترفض. 0 = مفيش حد أدنى." },
      { key: "maxAdvanceBookingDays", label: "أقصى مدة للحجز مقدمًا", unit: "يوم", min: 1, max: 1095, int: true, help: "العميل يقدر يحجز لحد المدة دي من النهارده." },
      { key: "overnightLatestEndHour", label: "الرحلة بعد نص الليل تخلص بحد أقصى الساعة", unit: "صباحًا", min: 0, max: 12, int: true, help: "رحلة زي 10 بالليل لـ 1 الصبح. 6 يعني لازم تخلص قبل 6 الصبح. 0 = ممنوع الرحلات بعد نص الليل." },
    ],
  },
  {
    title: "الإلغاء والفريق",
    tag: "العربون والباسوورد المؤقت",
    fields: [
      { key: "freeCancellationHours", label: "الإلغاء المجاني قبل الرحلة بـ", unit: "ساعة", min: 0, max: 720, int: true, help: "العميل اللي يلغي قبل الرحلة بالمدة دي أو أكتر بياخد العربون في محفظته. بعدها العربون بيتحجز (والزيادة فوقه بترجع). الأدمن يقدر يقرر غير كده وقت الإلغاء." },
      { key: "tempPasswordDays", label: "صلاحية الباسوورد المؤقت لعضو الفريق", unit: "يوم", min: 1, max: 90, int: true, help: "بعدها الباسوورد المؤقت مايشتغلش والـ Super Admin يعمل واحد جديد." },
    ],
  },
  {
    title: "الفلوس",
    tag: "عمولة وإحالة وذروة",
    fields: [
      { key: "defaultCommissionRate", label: "عمولة الشركة للسائق الجديد", unit: "%", min: 0, max: 100, help: "بتتحط للسائقين اللي بيتسجلوا بعد التغيير. عمولة كل سائق حالي بتتعدل من صفحته." },
      { key: "referralRewardAmount", label: "مكافأة الإحالة", unit: "ج.م", min: 0, max: 1_000_000, help: "رصيد بيتضاف لصاحب الكود لما أول رحلة للعميل اللي دعاه تخلص." },
      { key: "referredDiscountAmount", label: "خصم العميل المدعو على أول حجز", unit: "ج.م", min: 0, max: 1_000_000, help: "بيتخصم تلقائي من أول حجز للعميل اللي سجّل بكود إحالة. 0 = مفيش خصم." },
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

type Form = Record<NumKey, string>;

const toForm = (s: BusinessSettings): Form =>
  Object.fromEntries(GROUPS.flatMap((g) => g.fields).map((f) => [f.key, String(s[f.key])])) as Form;

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
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (q.data && !form) {
      setForm(toForm(q.data));
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
    return out;
  }, [form]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Only the values that differ from what is saved. */
  const changes = useMemo(() => {
    if (!form || !q.data) return null;
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const n = parse(form[f.key]);
      if (Number.isFinite(n) && n !== q.data[f.key]) body[f.key] = n;
    }
    return body;
  }, [form, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeCount = changes ? Object.keys(changes).length : 0;
  const hasErrors = Object.keys(errors).length > 0;

  const save = useMutation({
    mutationFn: () => api.put<SettingsResponse>("/admin/settings", changes),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      setForm(toForm(data));
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
    save.reset();
  };

  const actions = canEdit && (
    <>
      {saved && changeCount === 0 && <span className="fade-in text-[13px] text-mint">اتحفظ ✓</span>}
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
      <PageHeader eyebrow="قواعد الحجز والأسعار والتنبيهات" title="الإعدادات" actions={actions} />

      <Integrations />
      {q.error && <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {save.error && <ErrorBox error={errorMessage(save.error)} />}
      {!canEdit && q.data && (
        <div className="rounded-xl border border-line bg-raised px-4 py-3 text-[14px] text-muted">
          للعرض بس. تعديل الإعدادات محتاج صلاحية <span dir="ltr">settings:manage</span> (الـ Super Admin عنده الصلاحية دي).
        </div>
      )}

      {!form || !q.data ? (
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
                          <span className="shrink-0 text-[13px] text-muted">{f.unit}</span>
                        </span>
                      </Field>
                      <p className="px-1 text-[12px] leading-relaxed text-muted">
                        {f.help} <span className="text-muted/70">الأصلي: {def.toLocaleString("en")}</span>
                      </p>
                    </div>
                  );
                })}
              </Panel>
            ))}
          </div>

          <div className="rounded-xl border border-line bg-raised px-4 py-3 text-[14px] text-cream">
            أسعار الزفاف والمشاوير والـ VIP في <Link to="/pricing" className="font-bold text-gold underline underline-offset-4">صفحة الأسعار</Link>.
          </div>

          <p className="text-[13px] leading-relaxed text-muted">
            التغيير بيسري على الحجوزات الجديدة بس. الحجوزات الموجودة بتفضل بسعرها وعربونها. كل تعديل بيتسجل في سجل التوثيق.
          </p>
        </>
      )}
    </Page>
  );
}

/** Which outside services the server has (set in its .env by whoever runs it). */
function Integrations() {
  const q = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.get<{ sms: boolean; push: boolean; roadDistances: boolean; production: boolean }>("/admin/integrations"),
    staleTime: 5 * 60_000,
  });
  if (!q.data) return null;
  const items: { on: boolean; label: string; off: string }[] = [
    { on: q.data.sms, label: "رسايل كود الدخول (SMS)", off: q.data.production ? "مش متظبطة: العملاء والسواقين مش هيقدروا يدخلوا" : "مش متظبطة (الكود بيظهر في التطبيق للتجربة)" },
    { on: q.data.push, label: "الإشعارات على الموبايل", off: "مش متظبطة: الإشعارات بتظهر جوه التطبيق بس" },
    { on: q.data.roadDistances, label: "المسافة بالطريق الفعلي", off: "مش متظبطة: المسافة تقديرية" },
  ];
  return (
    <section aria-label="الخدمات المتوصلة" className="card flex flex-col gap-2 p-[18px]">
      <h2 className="text-[16px] font-bold text-cream">الخدمات المتوصلة</h2>
      <ul className="grid gap-2 md:grid-cols-3">
        {items.map((i) => (
          <li key={i.label} className="flex items-start gap-2 rounded-xl border border-line bg-raised px-3 py-2.5 text-[13px]">
            <span className={cx("mt-1 size-2.5 shrink-0 rounded-full", i.on ? "bg-mint" : "bg-amber")} aria-hidden />
            <span className="flex flex-col">
              <b className="text-cream">{i.label}</b>
              <span className={i.on ? "text-mint" : "text-muted"}>{i.on ? "شغالة" : i.off}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted">بتتظبط من ملف الإعدادات على السيرفر (.env)، مش من هنا.</p>
    </section>
  );
}
