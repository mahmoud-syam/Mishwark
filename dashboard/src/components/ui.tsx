import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { Tone } from "../lib/labels";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

// ------------------------------------------------------------------ layout
export function Page({ children, width = "wide" }: { children: ReactNode; width?: "wide" | "narrow" | "medium" }) {
  const max = width === "narrow" ? "max-w-[680px]" : width === "medium" ? "max-w-[740px]" : "max-w-[1160px]";
  return <main className={cx("page-enter mx-auto flex w-full flex-col gap-[22px] px-4 py-10", max)}>{children}</main>;
}

// ------------------------------------------------------------------ motion
const NUM = /\d[\d,]*(?:\.\d+)?/g;
const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const decimalsOf = (tok: string) => (tok.split(".")[1] ?? "").length;
const formatLike = (v: number, tok: string) => {
  const d = decimalsOf(tok);
  return tok.includes(",") ? v.toLocaleString("en", { minimumFractionDigits: d, maximumFractionDigits: d }) : v.toFixed(d);
};
/** Text whose numbers can be animated (not times like "10:30"). */
const countable = (text: string) => /\d/.test(text) && !/\d:\d/.test(text);

/**
 * Counts the numbers inside a formatted value up to their target ("4,425 ج.م",
 * "72%", "9 / 14", "35.0K"), keeping the formatting. On a later change it
 * glides from the old numbers. Static when the user prefers reduced motion.
 */
export function CountUp({ text, duration = 750 }: { text: string; duration?: number }) {
  const [shown, setShown] = useState(() => (countable(text) && !prefersReducedMotion() ? text.replace(NUM, (t) => formatLike(0, t)) : text));
  const prev = useRef<string | null>(null);

  useEffect(() => {
    const from = prev.current;
    prev.current = text;
    if (from === text || !countable(text) || prefersReducedMotion()) {
      setShown(text);
      return;
    }
    const targets = text.match(NUM) ?? [];
    const starts = from ? from.match(NUM) ?? [] : [];
    const sameShape = starts.length === targets.length;
    const parse = (t: string) => Number(t.replace(/,/g, ""));
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      let i = 0;
      setShown(
        text.replace(NUM, (tok) => {
          const a = sameShape ? parse(starts[i]) : 0;
          i++;
          return formatLike(a + (parse(tok) - a) * e, tok);
        })
      );
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, duration]);

  return <>{shown}</>;
}

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-linear-135 from-gold to-gold-deep font-display text-ink"
      style={{ width: size, height: size, fontSize: size * 0.53 }}
      aria-hidden
    >
      M
    </span>
  );
}

export function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="Mishwark — الرئيسية">
      <BrandMark />
      <span className="font-display text-[17px] text-cream" dir="ltr">
        Mishwark
      </span>
    </Link>
  );
}

export function BackButton({ to }: { to?: string }) {
  const nav = useNavigate();
  return (
    <button
      type="button"
      onClick={() => (to ? nav(to) : window.history.length > 1 ? nav(-1) : nav("/"))}
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-raised text-[14px] text-cream transition hover:border-gold/60"
      aria-label="رجوع"
    >
      ←
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  back,
  leading,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  back?: boolean | string;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {back && <BackButton to={typeof back === "string" ? back : undefined} />}
        {leading}
        <div className="flex flex-col gap-1.5">
          {eyebrow && <div className="text-[12px] uppercase tracking-[2px] text-gold">{eyebrow}</div>}
          <h1 className="font-display text-[30px] leading-tight text-cream">{title}</h1>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// --------------------------------------------------------------- surfaces
export function Panel({
  title,
  tag,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  tag?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("flex flex-col rounded-[18px] border border-line bg-surface p-[22px]", className)}>
      {(title || tag) && (
        <div className="flex items-center justify-between gap-3 pb-4">
          <h2 className="text-[15px] font-bold text-cream">{title}</h2>
          {tag && <span className="text-[11px] text-muted">{tag}</span>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const valueTone: Record<Tone | "cream", string> = {
  gold: "text-gold",
  rose: "text-rose",
  mint: "text-mint",
  muted: "text-muted",
  cream: "text-cream",
};

export function StatCard({
  label,
  value,
  delta,
  deltaTone = "muted",
  tone = "gold",
  loading,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: Tone;
  tone?: Tone | "cream";
  loading?: boolean;
}) {
  return (
    <div className="lift relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-2xl border border-line bg-surface p-5 hover:border-gold/40">
      <div className="text-[12px] text-muted">{label}</div>
      {loading ? (
        <Skeleton className="my-2 h-9 w-24" />
      ) : (
        <div className={cx("font-display text-[30px] leading-[1.45]", valueTone[tone])}>
          {/* Numeric values ("9 / 14", "72%") must stay LTR inside RTL text; Arabic values flow naturally. */}
          <span className={typeof value === "string" && /[\u0600-\u06FF]/.test(value) ? undefined : "ltr"}>
            {typeof value === "string" || typeof value === "number" ? <CountUp text={String(value)} /> : value}
          </span>
        </div>
      )}
      <div className={cx("min-h-[17px] text-[11px]", valueTone[deltaTone])}>{loading ? "" : delta}</div>
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-linear-to-r from-gold to-gold/0" />
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stagger grid grid-cols-2 gap-[18px] lg:grid-cols-4">{children}</div>;
}

// ------------------------------------------------------------------ badges
const badgeTone: Record<Tone, { bg: string; text: string; dot: string }> = {
  mint: { bg: "bg-mint/15", text: "text-mint", dot: "bg-mint" },
  gold: { bg: "bg-gold/15", text: "text-gold", dot: "bg-gold" },
  rose: { bg: "bg-wine/25", text: "text-rose", dot: "bg-rose" },
  muted: { bg: "bg-muted/15", text: "text-muted", dot: "bg-muted" },
};

export function Badge({ tone, children, dot, className }: { tone: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  const t = badgeTone[tone];
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full text-[10px]", dot ? "px-2 py-[3px]" : "px-2.5 py-1", t.bg, t.text, className)}>
      {children}
      {dot && <span className={cx("size-1.5 rounded-[3px]", t.dot)} />}
    </span>
  );
}

// ----------------------------------------------------------------- buttons
type Variant = "primary" | "secondary" | "danger" | "ghost";
const btnVariant: Record<Variant, string> = {
  primary: "bg-gold text-ink hover:brightness-110 border border-gold",
  secondary: "bg-raised text-cream border border-line hover:border-gold/60",
  danger: "bg-wine/20 text-blush border border-wine hover:bg-wine/30",
  ghost: "text-muted hover:text-cream border border-transparent",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizing = size === "sm" ? "px-4 py-[9px] text-[11px] rounded-[9px]" : size === "lg" ? "px-6 py-3.5 text-[13px] rounded-xl" : "px-4 py-2.5 text-[12px] rounded-xl";
  return (
    <button
      type="button"
      {...rest}
      className={cx("inline-flex items-center justify-center gap-1.5 font-bold transition disabled:cursor-not-allowed disabled:opacity-50", sizing, btnVariant[variant], className)}
    >
      {children}
    </button>
  );
}

export function LinkButton({ to, variant = "secondary", children, className }: { to: string; variant?: Variant; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cx("inline-flex items-center justify-center gap-1.5 rounded-[9px] px-4 py-[9px] text-[11px] font-bold transition", btnVariant[variant], className)}>
      {children}
    </Link>
  );
}

export function Chips<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "rounded-full border px-[15px] py-[7px] text-[11px] transition",
              active ? "border-gold bg-gold/15 text-gold" : "border-line bg-raised text-muted hover:text-cream"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- avatars
export function Avatar({ text, size = 36, tone = "wine" }: { text: string; size?: number; tone?: "wine" | "gold" | "plain" }) {
  const bg =
    tone === "gold" ? "bg-linear-135 from-gold to-gold-deep text-ink" : tone === "plain" ? "bg-raised border border-line text-cream" : "bg-linear-135 from-wine to-wine-deep text-cream";
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-bold", bg)} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {text}
    </span>
  );
}

// ------------------------------------------------------------------ charts
export function BarChart({
  data,
  height = 117,
  format,
  overlay,
}: {
  data: { label: string; value: number; overlay?: number; title?: string }[];
  height?: number;
  format?: (n: number) => string;
  overlay?: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-2.5" style={{ height: height + 23 }}>
      {data.map((d, i) => {
        const h = Math.max(d.value > 0 ? 4 : 2, (d.value / max) * height);
        return (
          <div key={i} className="group flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="relative flex w-full items-end" style={{ height }}>
              <span className="pointer-events-none absolute inset-x-0 -top-0.5 text-center text-[10px] text-cream opacity-0 transition group-hover:opacity-100 ltr" style={{ bottom: h + 4, top: "auto" }}>
                {format ? format(d.value) : d.value}
              </span>
              <div
                className={cx("bar relative w-full overflow-hidden rounded-t-md", d.value > 0 ? "bg-linear-to-b from-gold to-gold-deep" : "bg-raised")}
                style={{ height: h, animationDelay: `${i * 45}ms` }}
                title={d.title}
              >
                {overlay && d.overlay != null && d.value > 0 && (
                  <div className="absolute inset-x-0 bottom-0 bg-wine/80" style={{ height: `${(d.overlay / d.value) * 100}%` }} />
                )}
              </div>
            </div>
            <span className="truncate text-[10px] text-muted">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ProgressBar({ value, tone = "gold" }: { value: number; tone?: "gold" | "rose" }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("progress-fill h-full rounded-full", tone === "rose" ? "bg-rose" : "bg-linear-to-l from-gold to-gold-deep")} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------ tables
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-right">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border-b border-line px-1.5 py-2 text-[11px] font-normal text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children: ReactNode; className?: string }) => (
  <td className={cx("border-b border-line px-1.5 py-2.5 text-[12px] text-cream", className)}>{children}</td>
);

// ---------------------------------------------------------- list rows (kv)
export function KeyValue({ label, value, tone = "cream" }: { label: ReactNode; value: ReactNode; tone?: Tone | "cream" }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <span className="text-[12px] font-bold text-cream">{label}</span>
      <span className={cx("text-[14px] font-bold", valueTone[tone])}>{value}</span>
    </div>
  );
}

// ------------------------------------------------------------------ states
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-md bg-raised", className)} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-muted">{children}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-wine bg-wine/15 px-4 py-3 text-[12px] text-blush" role="alert">
      <span>{error}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-bold underline underline-offset-4">
          حاول تاني
        </button>
      )}
    </div>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-raised px-3 pb-2.5 pt-2.5 focus-within:border-gold/60">
      <span className="text-[10px] text-muted">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-gold">{hint}</span>}
    </label>
  );
}

/** Bare input that sits inside a <Field>. */
export const fieldControl = "w-full bg-transparent text-[13px] font-bold text-cream outline-none placeholder:font-normal placeholder:text-muted/70";

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="text-[12px] font-bold text-cream">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative h-[18px] w-8 shrink-0 rounded-full border transition", checked ? "border-gold bg-gold/30" : "border-line bg-raised-2")}
      >
        <span className={cx("absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition-all", checked ? "left-[15px] bg-gold" : "left-[3px] bg-muted")} />
      </button>
    </label>
  );
}
