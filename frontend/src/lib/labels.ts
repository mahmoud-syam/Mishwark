import type { AuditAction, BookingStatus, DriverStatus } from "./types";

export type Tone = "mint" | "gold" | "rose" | "muted";

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "قيد المراجعة", tone: "gold" },
  CONFIRMED: { label: "مؤكد", tone: "mint" },
  COMPLETED: { label: "مكتمل", tone: "mint" },
  CANCELLED: { label: "ملغي", tone: "rose" },
};

export const DRIVER_STATUS: Record<DriverStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: "نشط", tone: "mint" },
  ONTRIP: { label: "في رحلة", tone: "gold" },
  OFF: { label: "خارج الخدمة", tone: "muted" },
  ONLEAVE: { label: "إجازة", tone: "muted" },
};

export const AUDIT_ACTION: Record<AuditAction, { label: string; tone: Tone }> = {
  CREATE: { label: "إنشاء", tone: "mint" },
  UPDATE: { label: "تعديل", tone: "gold" },
  DELETE: { label: "حذف", tone: "rose" },
};

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
};

export const VEHICLE_CATEGORY: Record<string, string> = {
  CAR: "ملاكي",
  VAN: "فان",
  BUS: "باص",
  TRUCK: "نقل",
  CLASSIC: "كلاسيك",
  LUXURY: "فاخرة",
};

export const PACKAGE_TYPE: Record<string, string> = {
  MULTI_CAR: "كذا عربية",
  MULTI_EVENT: "كذا مناسبة",
};

export const PACKAGE_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "شغّالة", tone: "mint" },
  COMPLETED: { label: "خلصت", tone: "muted" },
  CANCELLED: { label: "ملغية", tone: "rose" },
  EXPIRED: { label: "منتهية", tone: "muted" },
};
