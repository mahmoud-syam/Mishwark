export function paramStr(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export function queryNum(value: any, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) {
    const n = parseInt(value[0], 10);
    return isNaN(n) ? fallback : n;
  }
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

export function queryStr(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value[0];
  return value as string;
}
/** A page size from the query string: 1..max (100 by default), so one request can't pull a whole table. */
export function queryLimit(value: any, fallback: number, max = 100): number {
  return Math.min(max, Math.max(1, queryNum(value, fallback)));
}
