import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import type { DriverStatus, DriverSummary } from "../lib/types";
import { Empty, ErrorBox, Page, PageHeader, Skeleton } from "../components/ui";
import { DriverCard } from "./Overview";

const SETTABLE: { value: Exclude<DriverStatus, "ONTRIP">; label: string }[] = [
  { value: "ACTIVE", label: "نشط" },
  { value: "OFF", label: "خارج الخدمة" },
  { value: "ONLEAVE", label: "إجازة" },
];
const tones = ["wine", "gold", "plain"] as const;

export default function Drivers() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["drivers-summary", 50], queryFn: () => api.get<DriverSummary[]>("/admin/drivers-summary?limit=50") });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DriverStatus }) => api.patch(`/admin/drivers/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drivers-summary"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  return (
    <Page>
      <PageHeader back="/" eyebrow="Super Admin" title="كل السائقين" actions={q.data && <span className="text-[11px] text-muted">{q.data.length} سائق · مرتبين بإيراد الشهر</span>} />
      {q.error && <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {setStatus.error && <ErrorBox error={errorMessage(setStatus.error)} />}
      {q.isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : (q.data ?? []).length === 0 ? (
        <Empty>لسه مفيش سائقين مسجّلين.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {q.data!.map((d, i) => (
            <div key={d.id} className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-3">
              <DriverCard d={d} tone={tones[i % 3]} />
              <label className="flex items-center justify-between gap-2 px-1 text-[11px] text-muted">
                الحالة
                {d.status === "ONTRIP" ? (
                  <span className="text-gold">في رحلة دلوقتي</span>
                ) : (
                  <select
                    className="rounded-lg border border-line bg-raised px-2 py-1 text-[11px] text-cream outline-none focus:border-gold/60"
                    value={d.status}
                    disabled={setStatus.isPending}
                    onChange={(e) => setStatus.mutate({ id: d.id, status: e.target.value as DriverStatus })}
                  >
                    {SETTABLE.map((o) => (
                      <option key={o.value} value={o.value} className="bg-surface">
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
