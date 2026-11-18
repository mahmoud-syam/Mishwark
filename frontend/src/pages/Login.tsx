import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { api, ApiError, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Moon, Sun } from "lucide-react";
import { BrandMark, Button, ErrorBox } from "../components/ui";
import { useTheme } from "../lib/theme";

// Every step after the password carries the signed, short-lived loginToken.
type LoginResponse =
  | { passwordChangeRequired: true; loginToken: string; message: string }
  | { twoFactorSetupRequired: true; loginToken: string; secret: string; qrCodeDataURL: string; message: string }
  | { twoFactorRequired: true; loginToken: string; message: string };

type Step =
  | { kind: "credentials" }
  | { kind: "password"; loginToken: string }
  | { kind: "setup"; loginToken: string; secret: string; qr: string }
  | { kind: "challenge"; loginToken: string };

const stepFrom = (r: LoginResponse): Step =>
  "passwordChangeRequired" in r
    ? { kind: "password", loginToken: r.loginToken }
    : "twoFactorSetupRequired" in r
      ? { kind: "setup", loginToken: r.loginToken, secret: r.secret, qr: r.qrCodeDataURL }
      : { kind: "challenge", loginToken: r.loginToken };
const EXPIRED = /expired|Sign in again/i;

/** Blocked after too many wrong tries (429), or the account was disabled (403). */
const signInError = (err: unknown): string | null => {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 429) {
    const m = err.message.match(/(\d+) minute/);
    return `محاولات غلط كتير. استنى ${m ? `${m[1]} دقيقة` : "شوية"} وجرّب تاني.`;
  }
  if (err.status === 403 && /disabled/i.test(err.message)) return "الحساب ده موقوف. كلّم السوبر أدمن.";
  if (err.status === 403 && /temporary password/i.test(err.message)) return "الباسورد المؤقت ده انتهت صلاحيته. اطلب من السوبر أدمن باسورد جديد.";
  return null;
};

export default function Login() {
  const { me, refresh } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from || "/";

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me) return <Navigate to={from} replace />;

  const submitCredentials = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.raw<LoginResponse>("POST", "/auth/login", { email: email.trim(), password });
      setCode("");
      setStep(stepFrom(r));
    } catch (err) {
      setError(signInError(err) ?? (err instanceof ApiError && err.status < 500 ? "الإيميل أو الباسورد مش صح." : errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  /** The sign-in pass lasts 5 minutes; after that, start again from the password. */
  const restart = (msg: string) => {
    setStep({ kind: "credentials" });
    setPassword("");
    setError(msg);
  };

  const submitNewPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (step.kind !== "password") return;
    if (newPassword.length < 8) return setError("الباسورد لازم يكون 8 حروف على الأقل.");
    if (newPassword !== confirm) return setError("الباسوردين مش زي بعض.");
    setBusy(true);
    setError(null);
    try {
      const r = await api.raw<LoginResponse>("POST", "/auth/set-password", { loginToken: step.loginToken, newPassword });
      setNewPassword("");
      setConfirm("");
      setCode("");
      setStep(stepFrom(r));
    } catch (err) {
      if (err instanceof ApiError && EXPIRED.test(err.message)) restart("انتهت مهلة الدخول. ادخل تاني بالباسورد المؤقت.");
      else if (err instanceof ApiError && /different/i.test(err.message)) setError("اختار باسورد غير الباسورد المؤقت.");
      else setError(err instanceof ApiError && err.status < 500 ? "الباسورد مش مقبول. استخدم 8 حروف على الأقل." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (step.kind !== "setup" && step.kind !== "challenge") return;
    setBusy(true);
    setError(null);
    try {
      if (step.kind === "setup") {
        await api.raw("POST", "/auth/verify-2fa-setup", { loginToken: step.loginToken, token: code });
      } else {
        await api.raw("POST", "/auth/verify-2fa", { loginToken: step.loginToken, token: code });
      }
      const result = await refresh();
      const user = (result as { data?: { role?: { name?: string } } | null }).data;
      if (!user || !["SUPER_ADMIN", "ADMIN"].includes(user.role?.name ?? "")) {
        setError("الحساب ده مش حساب أدمن. لوحة التحكم للإدارة بس.");
        await api.raw("POST", "/auth/logout").catch(() => undefined);
        setStep({ kind: "credentials" });
        return;
      }
      nav(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && EXPIRED.test(err.message)) return restart("انتهت مهلة الدخول. ادخل تاني.");
      setError(signInError(err) ?? (err instanceof ApiError && err.status < 500 ? "الكود مش صح أو انتهت صلاحيته. جرّب الكود الجديد." : errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page-enter relative flex min-h-dvh items-center justify-center px-4 py-10">
      <button
        type="button"
        onClick={toggle}
        className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-[14px] text-cream shadow-[var(--shadow-card)] transition hover:border-gold/60 [&_svg]:size-4"
        aria-label={theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}
      >
        {theme === "dark" ? <Sun /> : <Moon />}
        {theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}
      </button>
      <div className="w-full max-w-[380px] rounded-[22px] border border-line bg-surface p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
        <div className="mb-7 flex flex-col items-center gap-2 text-center">
          <BrandMark size={56} />
          <div className="font-display text-[36px] leading-tight text-cream" dir="ltr">
            Mishwark
          </div>
          <div className="text-[14px] uppercase tracking-[2px] text-gold">لوحة التحكم</div>
        </div>

        {error && (
          <div className="mb-4">
            <ErrorBox error={error} />
          </div>
        )}

        {step.kind === "credentials" ? (
          <form onSubmit={submitCredentials} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] text-muted">الإيميل</span>
              <input className="field-input ltr text-left" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] text-muted">الباسورد</span>
              <input className="field-input ltr text-left" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <Button type="submit" variant="primary" size="lg" disabled={busy} className="mt-2">
              {busy ? "جاري التحقق…" : "دخول"}
            </Button>
          </form>
        ) : step.kind === "password" ? (
          <form onSubmit={submitNewPassword} className="flex flex-col gap-3">
            <div className="rounded-2xl border border-line bg-raised p-4 text-center">
              <div className="text-[15px] font-bold text-cream">اختار باسورد جديد</div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">دخلت بباسورد مؤقت. اختار باسورد خاص بيك (8 حروف على الأقل)، وبعدها هتفعّل التحقق بخطوتين.</p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] text-muted">الباسورد الجديد</span>
              <input className="field-input ltr text-left" type="password" autoComplete="new-password" required minLength={8} autoFocus value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] text-muted">اكتبه تاني</span>
              <input className="field-input ltr text-left" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <Button type="submit" variant="primary" size="lg" disabled={busy || newPassword.length < 8 || !confirm}>
              {busy ? "بيحفظ…" : "حفظ ومتابعة"}
            </Button>
            <button type="button" className="text-[13px] text-muted hover:text-cream" onClick={() => setStep({ kind: "credentials" })}>
              رجوع لتسجيل الدخول
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="flex flex-col gap-3">
            {step.kind === "setup" ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-raised p-4 text-center">
                <div className="text-[15px] font-bold text-cream">فعّل التحقق بخطوتين</div>
                <p className="text-[13px] leading-relaxed text-muted">
                  امسح الكود ده بتطبيق Google Authenticator أو Microsoft Authenticator، وبعدين اكتب الكود اللي ظهر.
                </p>
                <img src={step.qr} alt="QR code للتحقق بخطوتين" className="size-40 rounded-xl bg-white p-2" />
                <code className="ltr select-all break-all text-[13px] text-gold">{step.secret}</code>
              </div>
            ) : (
              <p className="text-center text-[14px] leading-relaxed text-muted">اكتب الكود المكوّن من 6 أرقام من تطبيق التحقق.</p>
            )}
            <input
              className="field-input ltr text-center text-[25px] tracking-[10px]"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-label="كود التحقق"
            />
            <Button type="submit" variant="primary" size="lg" disabled={busy || code.length !== 6}>
              {busy ? "جاري التحقق…" : "تأكيد"}
            </Button>
            <button type="button" className="text-[13px] text-muted hover:text-cream" onClick={() => setStep({ kind: "credentials" })}>
              رجوع لتسجيل الدخول
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
