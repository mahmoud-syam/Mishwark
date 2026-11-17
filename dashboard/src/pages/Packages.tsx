import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { egp, maskPhone } from "../lib/format";
import { PACKAGE_STATUS, PACKAGE_TYPE } from "../lib/labels";
import type { AdminPackage } from "../lib/types";
import { Badge, Button, Chips, Empty, ErrorBox, Page, PageHeader, Panel, Skeleton, Table, Td } from "../components/ui";

type Filter = "ACTIVE" | "ALL";

/** Inline editor for one package's discount %. */
function DiscountCell({ pkg, canEdit }: { pkg: AdminPackage; canEdit: boolean }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(String(pkg.discountPercentage));
  // Follow the saved value after a refetch, keeping the "saved" note visible.
  useEffect(() => setValue(String(pkg.discountPercentage)), [pkg.discountPercentage]);
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 100;
  const dirty = valid && n !== pkg.discountPercentage;

  const save = useMutation({
    mutationFn: () => api.patch<AdminPackage & { repriced: number }>(`/admin/packages/${pkg.id}/discount`, { discountPercentage: n }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  if (!canEdit || pkg.status !== "ACTIVE") return <span className="font-bold">{pkg.discountPercentage}%</span>;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          className={`ltr w-16 rounded-lg border bg-raised px-2 py-1.5 text-right text-[12px] font-bold text-cream outline-none focus:border-gold/60 ${valid ? (dirty ? "border-gold/70" : "border-line") : "border-wine"}`}
          inputMode="decimal"
          value={value}
          aria-label={`خصم ${pkg.packageName}`}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && dirty && save.mutate()}
        />
        <span className="text-[11px] text-muted">%</span>
        {dirty && (
          <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "…" : "حفظ"}
          </Button>
        )}
      </div>
      {save.data && !dirty && (
        <span className="fade-in text-[10px] text-mint">
          اتحفظ{save.data.repriced > 0 ? ` · اتعدّل سعر ${save.data.repriced} حجز` : ""}
        </span>
      )}
      {save.error && <span className="text-[10px] text-rose">{errorMessage(save.error)}</span>}
    </div>
  );
}

export default function Packages() {
  const { me } = useAuth();
  const canEdit = me?.role?.name === "SUPER_ADMIN" || !!me?.role?.permissions?.includes("booking:manage");
  const [filter, setFilter] = useState<Filter>("ACTIVE");
  const q = useQuery({
    queryKey: ["packages", filter],
    queryFn: () => api.page<AdminPackage>(`/admin/packages?limit=100${filter === "ACTIVE" ? "&status=ACTIVE" : ""}`),
  });
  const items = q.data?.items ?? [];
  const needDiscount = items.filter((p) => p.status === "ACTIVE" && p.discountPercentage === 0).length;

  return (
    <Page>
      <PageHeader
        back="/"
        eyebrow="Super Admin"
        title="الباكدجات"
        actions={
          <Chips
            label="فلتر الباكدجات"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ACTIVE", label: "الشغّالة" },
              { value: "ALL", label: "الكل" },
            ]}
          />
        }
      />
      {q.error && <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {needDiscount > 0 && (
        <div className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[12px] text-cream">
          {needDiscount === 1 ? "باكدج واحدة" : `${needDiscount} باكدجات`} لسه من غير خصم. حدد النسبة من عمود "الخصم".
        </div>
      )}

      <Panel title="باكدجات العملاء" tag="الخصم بيتطبق على حجوزات الباكدج اللي لسه ما اتدفعش فيها حاجة">
        {q.isPending ? (
          <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : items.length === 0 ? (
          <Empty>{filter === "ACTIVE" ? "مفيش باكدجات شغّالة دلوقتي." : "لسه مفيش باكدجات."}</Empty>
        ) : (
          <Table head={["الباكدج", "العميل", "الخصم", "الحجوزات", "الإجمالي", "اتخصم لحد دلوقتي", "الحالة"]}>
            {items.map((p) => (
              <tr key={p.id}>
                <Td>
                  <div className="font-bold">{p.packageName}</div>
                  <div className="text-[10px] text-muted">{PACKAGE_TYPE[p.packageType] ?? p.packageType}</div>
                </Td>
                <Td>
                  <Link to={`/customers/${p.customer.id}`} className="font-bold hover:text-gold">
                    {p.customer.name}
                  </Link>
                  <div className="ltr text-right text-[10px] text-muted">{maskPhone(p.customer.phoneNumber)}</div>
                </Td>
                <Td>
                  <DiscountCell key={p.id} pkg={p} canEdit={canEdit} />
                </Td>
                <Td>
                  {p.bookingsCount} حجز
                  {p.unpaidBookings > 0 && <div className="text-[10px] text-muted">منهم {p.unpaidBookings} مش مدفوعين</div>}
                </Td>
                <Td>{egp(p.totalPrice)}</Td>
                <Td className="text-mint">{p.discountGiven > 0 ? egp(p.discountGiven) : "—"}</Td>
                <Td>
                  <Badge tone={PACKAGE_STATUS[p.status]?.tone ?? "muted"}>{PACKAGE_STATUS[p.status]?.label ?? p.status}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <p className="text-[11px] leading-relaxed text-muted">
        العميل بيعمل الباكدج من التطبيق، والخصم بتحدده إنت هنا. الحجوزات اللي اتدفع فيها عربون بتفضل بسعرها. كل تغيير بيتسجل في سجل التوثيق.
      </p>
    </Page>
  );
}
