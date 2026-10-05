/**
 * Single source of truth for role and permission identifiers.
 *
 * Role names are mirrored by the `UserRole` Prisma enum on `Role.name`, so these
 * values must stay in sync with `prisma/models/enums.prisma`. Never compare a
 * role with a raw string literal elsewhere in the codebase - import from here.
 */

export const USER_ROLES = {
    SUPER_ADMIN: "SUPER_ADMIN",
    ADMIN: "ADMIN",
    CUSTOMER: "CUSTOMER",
    DRIVER: "DRIVER",
} as const;

export type UserRoleName = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const ALL_USER_ROLES: readonly UserRoleName[] = Object.values(USER_ROLES);

/** Roles allowed to reach `/admin/*`. */
export const ADMIN_ROLE_NAMES: readonly UserRoleName[] = [
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.ADMIN,
];

export const PERMISSIONS = {
    DASHBOARD_VIEW: "dashboard:view",
    USER_MANAGE: "user:manage",
    ROLE_MANAGE: "role:manage",
    BOOKING_MANAGE: "booking:manage",
    VEHICLE_MANAGE: "vehicle:manage",
    DRIVER_MANAGE: "driver:manage",
    PAYMENT_MANAGE: "payment:manage",
    SETTINGS_MANAGE: "settings:manage",
    REVIEW_MANAGE: "review:manage",
    WALLET_MANAGE: "wallet:manage",
    USER_PASSWORD_MANAGE: "user_password:manage",
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const DEFAULT_SIGNUP_ROLE: UserRoleName = USER_ROLES.CUSTOMER;

/**
 * Normalizes a role coming from a request, a JWT payload or the database.
 * Accepts legacy values such as `"Super Admin"`, `"super admin"`, `"super_admin"`.
 */
export const normalizeRoleName = (value: unknown): UserRoleName | null => {
    if (typeof value !== "string") return null;

    const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");

    return (ALL_USER_ROLES as readonly string[]).includes(normalized)
        ? (normalized as UserRoleName)
        : null;
};

export const isAdminRole = (value: unknown): boolean => {
    const role = normalizeRoleName(value);
    return role !== null && ADMIN_ROLE_NAMES.includes(role);
};

export const isSuperAdminRole = (value: unknown): boolean =>
    normalizeRoleName(value) === USER_ROLES.SUPER_ADMIN;

export const isDriverRole = (value: unknown): boolean =>
    normalizeRoleName(value) === USER_ROLES.DRIVER;

/**
 * Permissions are stored as names on the JWT, but historical tokens were signed
 * with raw Prisma `Permission` objects. Coerce anything into a comparable string
 * so `requirePermission` can never crash on `p.toLowerCase is not a function`.
 */
export const normalizePermissions = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];

    const names = value
        .map((permission) => {
            if (typeof permission === "string") return permission;
            if (permission && typeof permission === "object" && "name" in permission) {
                const name = (permission as { name?: unknown }).name;
                return typeof name === "string" ? name : null;
            }
            return null;
        })
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.toLowerCase());

    return Array.from(new Set(names));
};