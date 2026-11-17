import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api, download, errorMessage } from "../lib/api";
import type { AuditAction, AuditEntry } from "../lib/types";
import { AUDIT_ACTION } from "../lib/labels";
import { relativeStamp } from "../lib/format";
import { Badge, Button, Chips, Empty, ErrorBox, Page, PageHeader, Panel, Skeleton, Table, Td } from "../components/ui";

type Filter = "ALL" | AuditAction;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "ALL", label: "الكل" },
  { value: "DELETE", label: "حذف فقط" },
  { value: "UPDATE", label: "تعديل" },
  { value: "CREATE", label: "إنشاء" },
];
const PAGE_SIZE = 20;

export default function AuditLog() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const qs = filter === "ALL" ? "" : `&action=${filter}`;

  const q = useInfiniteQuery({
    queryKey: ["audit", filter],
    queryFn: ({ pageParam }) => api.page<AuditEntry>(`/admin/audit-logs?page=${pageParam}&limit=${PAGE_SIZE}${qs}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.pagination.total;

  const exportExcel = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await download(`/admin/audit-logs/export${filter === "ALL" ? "" : `?action=${filter}`}`, "audit-log.xlsx");
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Page>
      <PageHeader
        back="/"
        eyebrow="Super Admin"
        title={
          <>
            سجل التوثيق <span dir="ltr">(Audit Log)</span>
          </>
        }
        actions={
          <Button size="sm" onClick={exportExcel} disabled={exporting}>
            {exporting ? "جاري التصدير…" : "تصدير Excel"}
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips label="نوع العملية" value={filter} onChange={setFilter} options={FILTERS} />
        {total != null && <span className="text-[13px] text-muted">{total} عملية</span>}
      </div>

      {exportError && <ErrorBox error={exportError} />}
      {q.error && <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />}

      <Panel>
        {q.isPending ? (
          <div className="flex flex-col gap-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : rows.length === 0 ? (
          <Empty>مفيش عمليات مسجّلة {filter === "ALL" ? "لسه" : "من النوع ده"}.</Empty>
        ) : (
          <>
            <Table head={["التاريخ والوقت", "مين عمل الفعل", "الفعل", "على إيه", "التفاصيل"]}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{relativeStamp(r.createdAt)}</Td>
                  <Td className="whitespace-nowrap font-bold">{r.actorName || "النظام"}</Td>
                  <Td>
                    <Badge tone={AUDIT_ACTION[r.action].tone}>{AUDIT_ACTION[r.action].label}</Badge>
                  </Td>
                  <Td>{r.entityLabel}</Td>
                  <Td className="text-muted">
                    <span dir="auto">{r.details || "—"}</span>
                  </Td>
                </tr>
              ))}
            </Table>
            {q.hasNextPage && (
              <Button className="mt-4 w-full" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                {q.isFetchingNextPage ? "جاري التحميل…" : "عرض المزيد"}
              </Button>
            )}
          </>
        )}
      </Panel>

      <div className="rounded-xl border border-line bg-raised px-4 py-3 text-[13px] text-muted">
        🔒 كل عملية حذف أو تعديل حساس في النظام بتتسجل هنا تلقائيًا ومايتشالش. ده بيحميك لو احتجت ترجع تتبع أي تغيير حصل.
      </div>
    </Page>
  );
}
