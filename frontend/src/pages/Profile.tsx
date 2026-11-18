import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import { api, ApiError, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { initials } from "../lib/format";
import { ROLE_LABEL } from "../lib/labels";
import type { Me } from "../lib/types";
import { Avatar, Button, Field, KeyValue, Page, PageHeader, Panel, fieldControl } from "../components/ui";

const MAX_PHOTO = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** The API answers in English; these are the ones a team member can hit here. */
const ARABIC: [RegExp, string][] = [
  [/current password is wrong/i, "الباسورد الحالي غلط."],
  [/different from the current/i, "اختار باسورد مختلف عن الحالي."],
  [/at least 8/i, "الباسورد لازم يكون 8 حروف على الأقل."],
  [/real JPG|Unsupported file type/i, "الصورة لازم تكون JPG أو PNG أو WEBP."],
  [/too large/i, "الصورة أكبر من 5 ميجا."],
  [/Name is too short/i, "الاسم قصير، اكتب حرفين على الأقل."],
  [/Too many|locked|try again in/i, "محاولات غلط كتير. استنى شوية وجرّب تاني."],
];
const say = (e: unknown) => {
  if (e instanceof ApiError && e.status === 413) return "الصورة أكبر من 5 ميجا.";
  const msg = errorMessage(e);
  return ARABIC.find(([re]) => re.test(msg))?.[1] ?? msg;
};

/** The signed-in team member's own page: photo, name and password. */
export default function Profile() {
  const { me } = useAuth();
  if (!me) return null;
  return (
    <Page width="medium">
      <PageHeader eyebrow="حسابك على لوحة التحكم" title="البروفايل بتاعي" />
      <div className="mt-6 flex flex-col gap-5">
        <IdentityPanel me={me} />
        <PasswordPanel />
      </div>
    </Page>
  );
}

function Done({ children }: { children: string }) {
  return (
    <p role="status" className="flex items-center gap-1.5 text-[13px] font-bold text-mint">
      <CheckCircle2 className="size-4" /> {children}
    </p>
  );
}

function Problem({ error }: { error: unknown }) {
  return (
    <p role="alert" className="text-[13px] font-bold text-rose">
      {say(error)}
    </p>
  );
}

function IdentityPanel({ me }: { me: Me }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me.name);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => setName(me.name), [me.name]);

  // The new details replace the cached session so the side menu updates at once.
  const apply = (next: Me) => qc.setQueryData<Me | null>(["me"], (old) => (old ? { ...old, ...next, role: old.role } : old));

  const photo = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("photo", file);
      return api.upload<Me>("/auth/me/photo", form, "PUT");
    },
    onSuccess: (next) => {
      apply(next);
      setNotice("الصورة اتحفظت.");
    },
  });
  const removePhoto = useMutation({
    mutationFn: () => api.raw<Me>("DELETE", "/auth/me/photo"),
    onSuccess: (next) => {
      apply(next);
      setNotice("الصورة اتشالت.");
    },
  });
  const rename = useMutation({
    mutationFn: (n: string) => api.raw<Me>("PATCH", "/auth/me", { name: n }),
    onSuccess: (next) => {
      apply(next);
      qc.invalidateQueries({ queryKey: ["team"] });
      setNotice("الاسم اتحفظ.");
    },
  });

  const pick = (file: File | undefined) => {
    setNotice(null);
    setLocalError(null);
    photo.reset();
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return setLocalError("الصورة لازم تكون JPG أو PNG أو WEBP.");
    if (file.size > MAX_PHOTO) return setLocalError("الصورة أكبر من 5 ميجا.");
    photo.mutate(file);
  };

  const trimmed = name.trim();
  const canSave = trimmed.length >= 2 && trimmed !== me.name && !rename.isPending;
  const save = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (canSave) rename.mutate(trimmed);
  };
  const busy = photo.isPending || removePhoto.isPending;
  const error = photo.error ?? removePhoto.error ?? rename.error;

  return (
    <Panel title="الصورة والاسم">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="flex shrink-0 flex-col items-center gap-3">
          <Avatar text={initials(me.name)} src={me.pic || null} size={104} tone="gold" alt="صورتك" />
          <input
            ref={fileRef}
            type="file"
            accept={PHOTO_TYPES.join(",")}
            className="sr-only"
            aria-label="اختار صورة"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Camera className="size-4" /> {photo.isPending ? "بيترفع..." : me.pic ? "غيّر الصورة" : "حط صورة"}
            </Button>
            {me.pic && (
              <Button size="sm" variant="ghost" onClick={() => (setNotice(null), removePhoto.mutate())} disabled={busy} aria-label="شيل الصورة" title="شيل الصورة">
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
          <span className="text-[12px] text-muted">JPG أو PNG أو WEBP، لحد 5 ميجا</span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <form onSubmit={save} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="الاسم اللي بيظهر للفريق">
                <input className={fieldControl} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
              </Field>
            </div>
            <Button type="submit" variant="primary" disabled={!canSave}>
              {rename.isPending ? "بيتحفظ..." : "احفظ الاسم"}
            </Button>
          </form>
          <div className="flex flex-col">
            <KeyValue label="الإيميل (اسم الدخول)" value={<span dir="ltr">{me.email}</span>} />
            <KeyValue label="الصلاحية" value={<span dir="ltr">{ROLE_LABEL[me.role?.name ?? ""] ?? ""}</span>} />
          </div>
          <p className="text-[12px] text-muted">الإيميل هو اللي بتدخل بيه، ومش بيتغير من هنا.</p>
          {localError ? <p role="alert" className="text-[13px] font-bold text-rose">{localError}</p> : error ? <Problem error={error} /> : notice && <Done>{notice}</Done>}
        </div>
      </div>
    </Panel>
  );
}

function PasswordPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => api.raw("POST", "/auth/me/password", { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    change.reset();
    if (!current) return setLocalError("اكتب الباسورد الحالي.");
    if (next.length < 8) return setLocalError("الباسورد الجديد لازم يكون 8 حروف على الأقل.");
    if (next !== confirm) return setLocalError("تأكيد الباسورد مش زي الباسورد الجديد.");
    change.mutate();
  };

  return (
    <Panel title="تغيير الباسورد" tag={<KeyRound className="size-4" />}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="الباسورد الحالي">
            <input type="password" className={fieldControl} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" dir="ltr" />
          </Field>
          <Field label="الباسورد الجديد">
            <input type="password" className={fieldControl} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" dir="ltr" />
          </Field>
          <Field label="أكّد الباسورد الجديد">
            <input type="password" className={fieldControl} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" dir="ltr" />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-muted">8 حروف على الأقل. أي جهاز تاني داخل بحسابك هيتعمله خروج.</span>
          <Button type="submit" variant="primary" disabled={change.isPending}>
            {change.isPending ? "بيتغير..." : "غيّر الباسورد"}
          </Button>
        </div>
        {localError ? (
          <p role="alert" className="text-[13px] font-bold text-rose">{localError}</p>
        ) : change.error ? (
          <Problem error={change.error} />
        ) : (
          change.isSuccess && <Done>الباسورد اتغير. الأجهزة التانية اتعملها خروج، وإنت لسه داخل هنا.</Done>
        )}
      </form>
    </Panel>
  );
}
