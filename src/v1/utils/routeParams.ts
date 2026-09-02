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