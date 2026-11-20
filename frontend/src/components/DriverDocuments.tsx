import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, FileText, X } from "lucide-react";
import { api, API_BASE, errorMessage } from "../lib/api";
import { relativeStamp } from "../lib/format";
import { Badge, Button, cx, ErrorBox, Panel, Skeleton } from "./ui";

export type DocType = "NATIONAL_ID_FRONT" | "NATIONAL_ID_BACK" | "LICENSE_FRONT" | "LICENSE_BACK" | "CRIMINAL_RECORD";
export type DocState = "MISSING" | "PENDING" | "APPROVED" | "REJECTED";

export interface DocSummary {
  state: DocState;
  missing: number;
  pending: number;
  rejected: number;
  approved: number;
  required: number;
}

interface Doc {
  id?: string;
  type: DocType;
  status: DocState;
  mimeType?: string;
  size?: number;
  reviewNote?: string | null;
  uploadedAt?: string;
}

export const DOC_LABEL: Record<DocType, string> = {
  NATIONAL_ID_FRONT: "البطاقة (وش)",
  NATIONAL_ID_BACK: "البطاقة (ضهر)",
  LICENSE_FRONT: "الرخصة (وش)",
  LICENSE_BACK: "الرخصة (ضهر)",
  CRIMINAL_RECORD: "الفيش والتشبيه",
};

const STATE: Record<DocState, { label: string; tone: "mint" | "gold" | "rose" | "muted" }> = {
  APPROVED: { label: "مقبول", tone: "mint" },
  PENDING: { label: "مستني مراجعة", tone: "gold" },
  REJECTED: { label: "مرفوض", tone: "rose" },
  MISSING: { label: "لسه ما اترفعش", tone: "muted" },
};

/** One line for a driver card: are the papers complete and approved? */
export function DocumentsBadge({ s }: { s: DocSummary }) {
  const text =
    s.state === "APPROVED"
      ? "المستندات مقبولة"
      : s.state === "REJECTED"
        ? `${s.rejected} مستند مرفوض`
        : s.state === "PENDING"
          ? `${s.pending} مستند مستني مراجعة`
          : `ناقص ${s.missing} من ${s.required} مستندات`;
  return <Badge tone={STATE[s.state].tone}>{text}</Badge>;
}

/**
 * The driver's papers on his page: open each one (images inline, PDFs in a new
 * tab), approve it, or reject it with a reason the driver sees in the app.
 */
export default function DriverDocumentsPanel({ driverId }: { driverId: string }) {
  const q = useQuery({
    queryKey: ["driver-documents", driverId],
    queryFn: () => api.get<{ documents: Doc[]; summary: DocSummary; licence?: { number: string; expiry: string | null } }>(`/admin/drivers/${driverId}/documents`),
  });
  const s = q.data?.summary;
  return (
    <Panel title="المستندات" tag={s && <DocumentsBadge s={s} />} bodyClassName="flex flex-col gap-2">
      {q.error && <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.licence && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-line bg-raised px-3 py-2 text-[13px]">
          <span className="text-muted">
            رقم الرخصة: <b className="text-cream" dir="ltr">{q.data.licence.number || "—"}</b>
          </span>
          <span className="text-muted">
            تنتهي: <b className="text-cream" dir="ltr">{q.data.licence.expiry ?? "—"}</b>
          </span>
          <span className="text-[12px] text-muted">قارنهم بصور الرخصة قبل القبول.</span>
        </div>
      )}
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : (
        q.data?.documents.map((d) => <DocRow key={d.type} d={d} driverId={driverId} />)
      )}
      <p className="text-[12px] text-muted">المستندات محفوظة في مكان خاص، ومحدش يقدر يفتحها غير السواق نفسه وفريق الداشبورد.</p>
    </Panel>
  );
}

function DocRow({ d, driverId }: { d: Doc; driverId: string }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: (body: { status: "APPROVED" | "REJECTED"; note?: string }) => api.patch(`/admin/driver-documents/${d.id}`, body),
    onSuccess: () => {
      setRejecting(false);
      setNote("");
      ["driver-documents", "drivers-summary", "overview", "audit"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ["driver-documents", driverId] });
    },
  });
  const url = d.id ? `${API_BASE}/admin/driver-documents/${d.id}/file` : null;
  const isPdf = d.mimeType === "application/pdf";
  const st = STATE[d.status];
  return (
    <div className={cx("flex flex-col gap-2 rounded-xl border p-2.5", d.status === "REJECTED" ? "border-wine/50" : "border-line")}>
      <div className="flex items-center gap-3">
        {url && !isPdf ? (
          <a href={url} target="_blank" rel="noreferrer" className="block size-14 shrink-0 overflow-hidden rounded-lg border border-line bg-raised" title="فتح الصورة">
            <img src={url} alt={DOC_LABEL[d.type]} className="h-full w-full object-cover" loading="lazy" />
          </a>
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-muted">
            <FileText className="size-6" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-cream">{DOC_LABEL[d.type]}</div>
          <div className="text-[12px] text-muted">
            {d.uploadedAt ? `اترفع ${relativeStamp(d.uploadedAt)}${isPdf ? " · PDF" : ""}` : "السواق لسه ما رفعهوش من التطبيق"}
          </div>
          {d.status === "REJECTED" && d.reviewNote && <div className="text-[12px] text-rose">السبب: {d.reviewNote}</div>}
          {d.status === "PENDING" && d.reviewNote && <div className="text-[12px] font-bold text-gold">{d.reviewNote}</div>}
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      {url && (
        <div className="flex flex-wrap items-center gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-gold hover:underline">
            <ExternalLink className="size-3.5" /> فتح
          </a>
          <span className="flex-1" />
          {d.status !== "APPROVED" && (
            <Button size="sm" variant="primary" disabled={review.isPending} onClick={() => review.mutate({ status: "APPROVED" })}>
              <Check className="size-4" /> قبول
            </Button>
          )}
          {d.status !== "REJECTED" && !rejecting && (
            <Button size="sm" variant="danger" disabled={review.isPending} onClick={() => setRejecting(true)}>
              <X className="size-4" /> رفض
            </Button>
          )}
        </div>
      )}
      {rejecting && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-cream outline-none focus:border-gold/60"
            placeholder="سبب الرفض (السواق هيشوفه): الصورة مش واضحة…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            aria-label={`سبب رفض ${DOC_LABEL[d.type]}`}
            autoFocus
          />
          <Button size="sm" variant="danger" disabled={!note.trim() || review.isPending} onClick={() => review.mutate({ status: "REJECTED", note: note.trim() })}>
            ارفض
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            رجوع
          </Button>
        </div>
      )}
      {review.error && <ErrorBox error={errorMessage(review.error)} />}
    </div>
  );
}
