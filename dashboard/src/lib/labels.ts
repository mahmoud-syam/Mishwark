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
