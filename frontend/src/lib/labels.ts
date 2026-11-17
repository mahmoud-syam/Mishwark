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

export const FLEET_STATUS: Record<string, { label: string; tone: Tone }> = {
  AVAILABLE: { label: "متاحة", tone: "mint" },
  BOOKED: { label: "محجوزة النهارده", tone: "gold" },
  MAINTENANCE: { label: "صيانة", tone: "rose" },
  RETIRED: { label: "موقوفة", tone: "muted" },
};

export const MAINTENANCE_STATE: Record<string, { label: string; tone: Tone }> = {
  SCHEDULED: { label: "مجدولة", tone: "gold" },
  IN_PROGRESS: { label: "جارية", tone: "rose" },
  OVERDUE: { label: "عدّت مواعيدها", tone: "muted" },
  DONE: { label: "خلصت", tone: "mint" },
};

export const MAINTENANCE_TYPES = ["صيانة دورية", "تغيير زيت", "فرامل", "كاوتش", "كهرباء", "تكييف", "غسيل وتلميع", "سمكرة ودهان"];
