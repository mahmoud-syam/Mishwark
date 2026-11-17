import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { Tone } from "../lib/labels";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

// ------------------------------------------------------------------ layout
export function Page({ children, width = "wide" }: { children: ReactNode; width?: "wide" | "narrow" | "medium" }) {
  const max = width === "narrow" ? "max-w-[680px]" : width === "medium" ? "max-w-[760px]" : "max-w-[1240px]";
  return <div className={cx("page-enter mx-auto flex w-full flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8", max)}>{children}</div>;
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
      className="inline-flex shrink-0 items-center justify-center rounded-xl bg-linear-135 from-gold to-gold-deep font-display text-white shadow-[0_6px_16px_-6px_var(--color-gold)]"
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
      <span className="text-[17px] font-bold text-white" dir="ltr">
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
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[14px] text-cream shadow-[var(--shadow-card)] transition hover:border-gold/60"
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
        <div className="flex flex-col gap-1">
          {eyebrow && <div className="text-[12px] text-muted">{eyebrow}</div>}
          <h1 className="text-[24px] font-bold leading-tight text-cream">{title}</h1>
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
    <section className={cx("card flex flex-col p-[22px]", className)}>
      {(title || tag) && (
        <div className="flex items-center justify-between gap-3 pb-4">
          <h2 className="text-[16px] font-bold text-cream">{title}</h2>
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
  tone = "cream",
  icon,
  loading,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: Tone;
  tone?: Tone | "cream";
  /** Shown in a navy circle, like the design's KPI cards. */
  icon?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="card lift relative flex min-w-0 flex-col items-start gap-3 p-4 hover:border-gold/40 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
      {icon && (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-navy text-white shadow-[0_8px_18px_-8px_var(--color-navy)] dark:text-ink sm:size-12 [&_svg]:size-5" aria-hidden>
          {icon}
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
      <div className="text-[12px] text-muted">{label}</div>
      {loading ? (
        <Skeleton className="my-1.5 h-8 w-24" />
      ) : (
        <div className={cx("text-[22px] font-bold leading-[1.35] sm:text-[26px]", valueTone[tone])}>
          {/* Numeric values ("9 / 14", "72%") must stay LTR inside RTL text; Arabic values flow naturally. */}
          <span className={typeof value === "string" && /[\u0600-\u06FF]/.test(value) ? undefined : "ltr"}>
            {typeof value === "string" || typeof value === "number" ? <CountUp text={String(value)} /> : value}
          </span>
        </div>
      )}
      <div className={cx("min-h-[17px] text-[11px]", valueTone[deltaTone])}>{loading ? "" : delta}</div>
      </div>
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">{children}</div>;
}

// ------------------------------------------------------------------ badges
const badgeTone: Record<Tone, { bg: string; text: string; dot: string }> = {
  mint: { bg: "bg-mint/15", text: "text-mint", dot: "bg-mint" },
  gold: { bg: "bg-amber/15", text: "text-amber", dot: "bg-amber" },
  rose: { bg: "bg-wine/15", text: "text-rose", dot: "bg-rose" },
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
  primary: "bg-linear-to-l from-gold to-gold-deep text-white border border-gold shadow-[0_8px_18px_-10px_var(--color-gold)] hover:brightness-105",
  secondary: "bg-surface text-cream border border-line hover:border-gold/60",
  danger: "bg-wine/10 text-blush border border-wine/60 hover:bg-wine/20",
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
              active ? "border-gold bg-gold/12 font-bold text-gold" : "border-line bg-surface text-muted hover:text-cream"
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
    tone === "gold" ? "bg-linear-135 from-gold to-gold-deep text-white" : tone === "plain" ? "bg-raised border border-line text-cream" : "bg-linear-135 from-navy to-navy-soft text-white dark:text-ink";
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-bold", bg)} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {text}
    </span>
  );
}

// ------------------------------------------------------------------ charts
export function BarChart({
  data,
  height = 160,
  format,
  overlay,
  highlight,
}: {
  data: { label: string; value: number; overlay?: number; title?: string; caption?: string }[];
  height?: number;
  format?: (n: number) => string;
  overlay?: boolean;
  /** Index of the bar drawn darker with its value box always shown (e.g. today). */
  highlight?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const top = niceCeil(max);
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((t) => t * top);
  return (
    <div className="flex gap-3">
      <div className="flex shrink-0 flex-col justify-between pb-6 text-[10px] text-muted ltr" style={{ height: height + 24 }} aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="leading-none">{format ? format(t) : t}</span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="h-px w-full border-t border-dashed border-line" />
          ))}
        </div>
        <div className="relative flex items-end gap-1 sm:gap-2" style={{ height: height + 24 }}>
          {data.map((d, i) => {
            const h = Math.max(d.value > 0 ? 6 : 3, (d.value / top) * height);
            const hot = i === highlight;
            return (
              <div key={i} className="group flex min-w-0 flex-1 flex-col items-center gap-2" title={d.title}>
                <div className="relative flex w-full items-end justify-center" style={{ height }}>
                  <span
                    className={cx(
                      "pointer-events-none absolute z-10 flex flex-col items-center whitespace-nowrap rounded-lg bg-navy px-2.5 py-1.5 text-center text-white shadow-lg transition dark:text-ink",
                      hot ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}
                    style={{ bottom: h + 8 }}
                  >
                    {d.caption && <span className="text-[9px] opacity-80">{d.caption}</span>}
                    <span className="text-[12px] font-bold ltr">{format ? format(d.value) : d.value}</span>
                  </span>
                  <div
                    className={cx(
                      "bar relative w-[clamp(10px,45%,22px)] overflow-hidden rounded-t-full",
                      d.value <= 0 ? "bg-raised-2" : hot ? "bg-navy" : "bg-linear-to-b from-navy-soft to-navy-soft/35 group-hover:from-navy group-hover:to-navy/60"
                    )}
                    style={{ height: h, animationDelay: `${i * 45}ms` }}
                  >
                    {overlay && d.overlay != null && d.value > 0 && (
                      <div className="absolute inset-x-0 bottom-0 bg-gold/80" style={{ height: `${(d.overlay / d.value) * 100}%` }} />
                    )}
                  </div>
                </div>
                <span className={cx("truncate text-[10px]", hot ? "font-bold text-cream" : "text-muted")}>{d.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A round axis maximum whose quarters are round too (24K → 6K, 12K, 18K). */
function niceCeil(n: number) {
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 1.2, 1.6, 2, 2.4, 3.2, 4, 6, 8, 10]) if (m * p >= n) return m * p;
  return 10 * p;
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
