import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import type { Vehicle, VehicleStatus } from "../lib/types";
import { Button, ErrorBox, Field, fieldControl, Skeleton } from "./ui";

const STATUS_OPTIONS: { value: VehicleStatus; label: string }[] = [
  { value: "AVAILABLE", label: "متاحة" },
  { value: "MAINTENANCE", label: "صيانة" },
];

/** Modal to edit a vehicle's pricing and service status. Every change is audit-logged server-side. */
export default function VehicleEditor({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const q = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => api.raw<{ data: Vehicle }>("GET", `/vehicles/${vehicleId}`).then((r) => r.data),
  });
  const [form, setForm] = useState<{ basePrice: string; pricePerKm: string; status: VehicleStatus } | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (q.data && !form) setForm({ basePrice: String(q.data.basePrice), pricePerKm: String(q.data.pricePerKm), status: q.data.status === "MAINTENANCE" ? "MAINTENANCE" : "AVAILABLE" });
  }, [q.data, form]);

  const save = useMutation({
    mutationFn: () => {
      const v = q.data!;
      const patch: Record<string, unknown> = {};
      if (Number(form!.basePrice) !== v.basePrice) patch.basePrice = Number(form!.basePrice);
      if (Number(form!.pricePerKm) !== v.pricePerKm) patch.pricePerKm = Number(form!.pricePerKm);
      const currentStatus = v.status === "MAINTENANCE" ? "MAINTENANCE" : "AVAILABLE";
      if (form!.status !== currentStatus) patch.status = form!.status;
      if (Object.keys(patch).length === 0) return Promise.resolve(null);
      return api.patch(`/admin/vehicles/${vehicleId}`, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fleet"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      qc.invalidateQueries({ queryKey: ["audit"] });
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const valid = form && Number(form.basePrice) >= 0 && Number(form.pricePerKm) >= 0 && form.basePrice !== "" && form.pricePerKm !== "";

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      className="m-auto w-[min(420px,calc(100vw-2rem))] rounded-[18px] border border-line bg-surface p-0 text-cream backdrop:bg-ink/70 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 p-[22px]">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold">{q.data ? `${q.data.make} ${q.data.model}` : "تعديل العربية"}</h2>
          <button type="button" onClick={() => dialog.current?.close()} className="text-muted hover:text-cream" aria-label="إغلاق">
            ✕
          </button>
        </div>
        {q.error && <ErrorBox error={errorMessage(q.error)} />}
        {!form ? (
          <Skeleton className="h-36" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="السعر الأساسي (ج.م)">
                <input className={`${fieldControl} ltr text-right`} type="number" min={0} step={50} value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} />
              </Field>
              <Field label="السعر لكل كم (ج.م)">
                <input className={`${fieldControl} ltr text-right`} type="number" min={0} step={5} value={form.pricePerKm} onChange={(e) => setForm({ ...form, pricePerKm: e.target.value })} />
              </Field>
            </div>
            <Field label="الحالة">
              <select className={fieldControl} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as VehicleStatus })}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} className="bg-surface">
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-[10px] text-muted">التعديل بيسري على الحجوزات الجديدة بس، وبيتسجّل في سجل التوثيق.</p>
          </>
        )}
        {save.error && <ErrorBox error={errorMessage(save.error)} />}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" className="flex-1" disabled={!valid || save.isPending}>
            {save.isPending ? "جاري الحفظ…" : "حفظ"}
          </Button>
          <Button onClick={() => dialog.current?.close()}>إلغاء</Button>
        </div>
      </form>
    </dialog>
  );
}
