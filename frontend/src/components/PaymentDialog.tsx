import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "../lib/api";
import type { DayDetails, PaymentMethod } from "../lib/types";
import { egp, relativeStamp } from "../lib/format";
import { Badge, Button, ErrorBox, Field, fieldControl } from "./ui";

type Booking = DayDetails["bookings"][number];

const METHOD: Record<PaymentMethod, string> = { CASH: "كاش", PAYMOB: "Paymob", FAWRY: "فوري", WALLET: "المحفظة" };
const STATUS = {
  PENDING: { label: "مستني تأكيد", tone: "gold" as const },
  SUCCESS: { label: "اتأكد", tone: "mint" as const },
  FAILED: { label: "مرفوض", tone: "rose" as const },
  REFUNDED: { label: "مسترد", tone: "muted" as const },
};

/**
 * Payment window for one booking: confirm/reject what the customer submitted,
 * or record money the office received (cash or transfer). Only admins and the
 * assigned driver can confirm payments; confirming the deposit confirms the
 * booking automatically. Every change lands in the audit log.
 */
export default function PaymentDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const qc = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const remaining = Math.max(0, Math.round((booking.totalPrice - booking.paid) * 100) / 100);
  const depositDue = Math.max(0, Math.round((booking.depositRequired - booking.paid) * 100) / 100);
  const [amount, setAmount] = useState(String(depositDue > 0 ? depositDue : remaining));
  const [method, setMethod] = useState<PaymentMethod>("CASH");

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const refresh = () => {
    ["day", "bookings", "overview", "customer-analytics", "driver-analytics", "audit", "recent-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const settle = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "SUCCESS" | "FAILED" }) => api.patch(`/payments/${id}/status`, { status }),
    onSuccess: refresh,
  });
  const record = useMutation({
    mutationFn: async () => {
      const p = await api.post<{ id: string }>("/payments", { bookingId: booking.id, amount: Number(amount), paymentMethod: method });
      await api.patch(`/payments/${p.id}/status`, { status: "SUCCESS" });
    },
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    record.mutate();
  };
  const amountNum = Number(amount);
  const valid = amountNum > 0 && amountNum <= remaining + 0.001;
  const err = settle.error ?? record.error;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      className="m-auto w-[min(460px,calc(100vw-2rem))] rounded-[18px] border border-line bg-surface p-0 text-cream backdrop:bg-ink/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-4 p-[22px]">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold">
            الدفع · <span className="ltr text-muted">#{booking.ref}</span>
          </h2>
          <button type="button" onClick={() => dialog.current?.close()} className="text-muted hover:text-cream" aria-label="إغلاق">
            <X className="size-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { k: "الإجمالي", v: egp(booking.totalPrice), c: "text-cream" },
            { k: "اتدفع", v: egp(booking.paid), c: "text-mint" },
            { k: "الباقي", v: egp(remaining), c: remaining > 0 ? "text-rose" : "text-mint" },
          ].map((x) => (
            <div key={x.k} className="rounded-xl border border-line bg-raised px-2 py-2.5">
              <div className="text-[12px] text-muted">{x.k}</div>
              <div className={`text-[15px] font-bold ${x.c}`}>{x.v}</div>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-muted">
          العربون المطلوب للتأكيد: <b className="text-cream">{egp(booking.depositRequired)}</b>
          {depositDue > 0 ? <span className="text-gold"> · لسه {egp(depositDue)}</span> : <span className="text-mint"> · اتدفع ✓</span>}
        </p>
        {(booking.packageDiscount > 0 || booking.referralDiscount > 0) && (
          <p className="text-[13px] text-muted">
            الإجمالي بعد الخصم
            {booking.packageDiscount > 0 && <span> · خصم الباكدج <b className="text-mint">{egp(booking.packageDiscount)}</b></span>}
            {booking.referralDiscount > 0 && <span> · خصم الإحالة <b className="text-mint">{egp(booking.referralDiscount)}</b></span>}
          </p>
        )}

        {booking.payments.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {booking.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[14px] font-bold text-cream">
                    {egp(p.amount)} <span className="font-normal text-muted">· {METHOD[p.paymentMethod]}</span>
                  </div>
                  <div className="text-[12px] text-muted">{relativeStamp(p.createdAt)}</div>
                </div>
                {p.status === "PENDING" ? (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="primary" disabled={settle.isPending} onClick={() => settle.mutate({ id: p.id, status: "SUCCESS" })}>
                      تأكيد الاستلام
                    </Button>
                    <Button size="sm" variant="danger" disabled={settle.isPending} onClick={() => settle.mutate({ id: p.id, status: "FAILED" })}>
                      رفض
                    </Button>
                  </div>
                ) : (
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}

        {remaining > 0 && (
          <form onSubmit={submit} className="flex flex-col gap-2.5 border-t border-line pt-4">
            <div className="text-[14px] font-bold">تسجيل مبلغ اتستلم</div>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="المبلغ (ج.م)">
                <input className={`${fieldControl} ltr text-right`} type="number" min={1} max={remaining} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="طريقة الدفع">
                <select className={fieldControl} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {(["CASH", "PAYMOB", "FAWRY"] as PaymentMethod[]).map((m) => (
                    <option key={m} value={m} className="bg-surface">
                      {METHOD[m]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex gap-2 text-[12px]">
              {depositDue > 0 && (
                <button type="button" className="text-gold hover:underline" onClick={() => setAmount(String(depositDue))}>
                  العربون ({egp(depositDue)})
                </button>
              )}
              <button type="button" className="text-gold hover:underline" onClick={() => setAmount(String(remaining))}>
                المبلغ كله ({egp(remaining)})
              </button>
            </div>
            <Button type="submit" variant="primary" disabled={!valid || record.isPending}>
              {record.isPending ? "جاري التسجيل…" : "تسجيل وتأكيد"}
            </Button>
          </form>
        )}

        {err && <ErrorBox error={err instanceof ApiError ? err.message : errorMessage(err)} />}
      </div>
    </dialog>
  );
}
