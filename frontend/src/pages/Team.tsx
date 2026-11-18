import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { relativeStamp } from "../lib/format";
import type { TeamMember, TeamRole } from "../lib/types";
import { Avatar, Badge, Button, cx, Empty, ErrorBox, Field, fieldControl, Page, PageHeader, Panel, Skeleton } from "../components/ui";
import { initials } from "../lib/format";

const ROLE: Record<TeamRole, string> = { SUPER_ADMIN: "سوبر أدمن", ADMIN: "أدمن" };

const AR: Record<string, string> = {
  "This email is already used by another account": "الإيميل ده مستخدم في حساب تاني.",
  "You can't change your own account from the Team page": "ما ينفعش تعدّل حسابك من هنا.",
  "Only a Super Admin can manage team accounts": "الصفحة دي للسوبر أدمن بس.",
};
const msg = (e: unknown) => (e instanceof ApiError && AR[e.message] ? AR[e.message] : e instanceof ApiError && e.status === 422 ? "راجع الاسم والإيميل." : errorMessage(e));

/** A temporary password is shown once: the server keeps only its hash. */
function TempPassword({ who, password, onDone }: { who: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="fade-in rounded-2xl border border-gold/50 bg-gold/10 p-4" role="status">
      <div className="text-[13px] font-bold text-cream">الباسورد المؤقت لـ {who}</div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="ltr select-all rounded-lg bg-ink px-3 py-2 text-[18px] tracking-[2px] text-gold">{password}</code>
        <Button size="sm" onClick={copy}>{copied ? "اتنسخ ✓" : "نسخ"}</Button>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        ابعته له بنفسك. مش هيظهر تاني بعد ما تقفل الرسالة دي. أول ما يدخل بيه هيختار باسورد خاص بيه، وبعدين يفعّل التحقق بخطوتين.
      </p>
      <Button size="sm" variant="ghost" className="mt-2" onClick={onDone}>
        تمام، بعتّه
      </Button>
    </div>
  );
}

function AddMember({ onCreated }: { onCreated: (name: string, password: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", email: "", role: "ADMIN" as TeamRole });
  const valid = f.name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(f.email.trim());
  const create = useMutation({
    mutationFn: () => api.post<{ member: TeamMember; temporaryPassword: string }>("/admin/team", { ...f, name: f.name.trim(), email: f.email.trim() }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["team"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
      setF({ name: "", email: "", role: "ADMIN" });
      onCreated(r.member.name, r.temporaryPassword);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) create.mutate();
  };
  return (
    <Panel title="إضافة حساب" bodyClassName="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="الاسم">
          <input className={fieldControl} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="سارة أحمد" aria-label="الاسم" />
        </Field>
        <Field label="الإيميل">
          <input className={cx(fieldControl, "ltr text-right")} type="email" value={f.email} maxLength={120} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="sara@company.com" aria-label="الإيميل" />
        </Field>
        <Field label="الدور" hint={f.role === "SUPER_ADMIN" ? "صلاحيات كاملة، منها إدارة الحسابات دي." : "يشتغل على الداشبورد من غير إدارة الحسابات."}>
          <select className={fieldControl} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as TeamRole })} aria-label="الدور">
            <option value="ADMIN" className="bg-surface">أدمن</option>
            <option value="SUPER_ADMIN" className="bg-surface">سوبر أدمن</option>
          </select>
        </Field>
        {create.error && <ErrorBox error={msg(create.error)} />}
        <Button type="submit" variant="primary" disabled={!valid || create.isPending}>
          {create.isPending ? "…" : "إنشاء الحساب"}
        </Button>
      </form>
    </Panel>
  );
}

/** Needs a second click to run, so a reset is never a misclick. */
function ConfirmButton({ label, confirm, onConfirm, busy }: { label: string; confirm: string; onConfirm: () => void; busy: boolean }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="flex items-center gap-1">
      <Button size="sm" variant="danger" disabled={busy} onClick={() => { setArmed(false); onConfirm(); }}>
        {confirm}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>لأ</Button>
    </span>
  ) : (
    <Button size="sm" onClick={() => setArmed(true)} disabled={busy}>
      {label}
    </Button>
  );
}

function MemberRow({ m, self, onPassword }: { m: TeamMember; self: boolean; onPassword: (name: string, password: string) => void }) {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ["team"] });
    qc.invalidateQueries({ queryKey: ["audit"] });
  };
  const reset2fa = useMutation({ mutationFn: () => api.post(`/admin/team/${m.id}/reset-2fa`), onSuccess: done });
  const resetPw = useMutation({
    mutationFn: () => api.post<{ temporaryPassword: string }>(`/admin/team/${m.id}/reset-password`),
    onSuccess: (r) => {
      done();
      onPassword(m.name, r.temporaryPassword);
    },
  });
  const role = useMutation({ mutationFn: (r: TeamRole) => api.patch(`/admin/team/${m.id}/role`, { role: r }), onSuccess: done });
  const disable = useMutation({ mutationFn: () => api.post(`/admin/team/${m.id}/disable`), onSuccess: done });
  const enable = useMutation({ mutationFn: () => api.post(`/admin/team/${m.id}/enable`), onSuccess: done });
  const busy = reset2fa.isPending || resetPw.isPending || role.isPending || disable.isPending || enable.isPending;
  const err = reset2fa.error ?? resetPw.error ?? role.error ?? disable.error ?? enable.error;
  const off = !!m.disabledAt;

  return (
    <li className={cx("flex flex-col gap-3 border-b border-line py-4 last:border-b-0", off && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar text={initials(m.name)} tone={m.role === "SUPER_ADMIN" ? "gold" : "wine"} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-bold text-cream">
              {m.name} {self && <span className="text-[11px] font-normal text-muted">(إنت)</span>}
            </span>
            <span className="ltr truncate text-right text-[11px] text-muted">{m.email}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Badge tone={m.role === "SUPER_ADMIN" ? "gold" : "muted"}>{ROLE[m.role]}</Badge>
          {off ? (
            <Badge tone="rose">موقوف من {relativeStamp(m.disabledAt!)}</Badge>
          ) : m.mustChangePassword ? (
            <Badge tone="gold">لسه ما دخلش بالباسورد المؤقت</Badge>
          ) : m.twoFactorEnabled ? (
            <Badge tone="mint">التحقق بخطوتين مفعّل</Badge>
          ) : (
            <Badge tone="rose">لازم يفعّل التحقق بخطوتين</Badge>
          )}
          <span className="text-muted">{m.lastLoginAt ? `آخر دخول ${relativeStamp(m.lastLoginAt)}` : "ما دخلش لسه"}</span>
        </div>
      </div>
      {!self && off && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted">ما يقدرش يدخل. سجله وتعديلاته محفوظين.</span>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => enable.mutate()}>
            إعادة تفعيل الحساب
          </Button>
        </div>
      )}
      {!self && !off && (
        <div className="flex flex-wrap items-center gap-2">
          <ConfirmButton label="🔐 إعادة ضبط التحقق بخطوتين" confirm="أكيد؟ هيعيد الإعداد في الدخول الجاي" busy={busy} onConfirm={() => reset2fa.mutate()} />
          <ConfirmButton label="🔑 باسورد مؤقت جديد" confirm="أكيد؟ الباسورد القديم هيتلغي" busy={busy} onConfirm={() => resetPw.mutate()} />
          <select
            className="rounded-xl border border-line bg-raised px-3 py-1.5 text-[11px] text-cream outline-none focus:border-gold/60"
            value={m.role}
            disabled={busy}
            onChange={(e) => role.mutate(e.target.value as TeamRole)}
            aria-label={`دور ${m.name}`}
          >
            <option value="ADMIN">أدمن</option>
            <option value="SUPER_ADMIN">سوبر أدمن</option>
          </select>
          <ConfirmButton label="⛔ إيقاف الحساب" confirm="أكيد؟ هيخرج فورًا ومش هيقدر يدخل" busy={busy} onConfirm={() => disable.mutate()} />
          {reset2fa.isSuccess && <span className="fade-in text-[11px] text-mint">اتعمل ✓ وخرج من كل الأجهزة</span>}
          {role.isSuccess && <span className="fade-in text-[11px] text-mint">الدور اتغيّر ✓</span>}
        </div>
      )}
      {err && <ErrorBox error={msg(err)} />}
    </li>
  );
}

export default function Team() {
  const { me, isSuperAdmin } = useAuth();
  const q = useQuery({ queryKey: ["team"], queryFn: () => api.get<TeamMember[]>("/admin/team"), enabled: isSuperAdmin });
  const [shown, setShown] = useState<{ name: string; password: string } | null>(null);

  if (!isSuperAdmin) {
    return (
      <Page width="medium">
        <PageHeader back="/" eyebrow="الإدارة" title="الفريق" />
        <ErrorBox error="الصفحة دي للسوبر أدمن بس." />
      </Page>
    );
  }
  const show = (name: string, password: string) => setShown({ name, password });
  const list = q.data ?? [];
  const active = list.filter((m) => !m.disabledAt);
  const pending = active.filter((m) => m.mustChangePassword || !m.twoFactorEnabled).length;
  const disabledCount = list.length - active.length;

  return (
    <Page>
      <PageHeader back="/" eyebrow="الإدارة" title="الفريق" actions={q.data && <span className="text-[11px] text-muted">{active.length} حساب شغّال{pending ? ` · ${pending} لسه ما كمّلوش التفعيل` : ""}{disabledCount ? ` · ${disabledCount} موقوف` : ""}</span>} />
      <p className="text-[12px] leading-relaxed text-muted">
        كل واحد في الفريق له حساب باسمه، والتحقق بخطوتين إجباري للكل. لو حد ضيّع موبايله أو نسي الباسورد، اعمل له إعادة ضبط من هنا. ولو حد ساب الشغل، أوقف حسابه. أي إجراء بيخرّجه من كل الأجهزة، وبيتسجل في سجل التعديلات.
      </p>
      {shown && <TempPassword who={shown.name} password={shown.password} onDone={() => setShown(null)} />}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="الحسابات">
            {q.error ? (
              <ErrorBox error={msg(q.error)} onRetry={() => q.refetch()} />
            ) : q.isPending ? (
              <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : list.length === 0 ? (
              <Empty>مفيش حسابات.</Empty>
            ) : (
              <ul className="flex flex-col">
                {list.map((m) => (
                  <MemberRow key={m.id} m={m} self={m.id === me?.id} onPassword={show} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <AddMember onCreated={show} />
      </div>
    </Page>
  );
}
