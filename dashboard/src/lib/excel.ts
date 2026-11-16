import { saveBlob } from "./api";

/**
 * Client-side Excel export for report screens. SheetJS is loaded on demand so
 * it stays out of the main bundle.
 */
export async function exportWorkbook(filename: string, sheets: { name: string; rows: Record<string, string | number>[] }[]) {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  book.Workbook = { Views: [{ RTL: true }] };
  for (const s of sheets) {
    const sheet = XLSX.utils.json_to_sheet(s.rows);
    const keys = Object.keys(s.rows[0] ?? {});
    sheet["!cols"] = keys.map((k) => ({ wch: Math.max(12, k.length + 4, ...s.rows.map((r) => String(r[k] ?? "").length + 2)) }));
    XLSX.utils.book_append_sheet(book, sheet, s.name.slice(0, 31));
  }
  const out = XLSX.write(book, { type: "array", bookType: "xlsx" });
  saveBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}
