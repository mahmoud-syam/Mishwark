import prismaClient from "../utils/prismaClientHelper";
import { USER_ROLES, UserRoleName } from "../constants/roles";

const ROLE_DESCRIPTIONS: Record<UserRoleName, string> = {
    [USER_ROLES.SUPER_ADMIN]: "Super Administrator with full system access",
    [USER_ROLES.ADMIN]: "System Administrator",
    [USER_ROLES.CUSTOMER]: "Customer Account",
    [USER_ROLES.DRIVER]: "Driver Account",
};

/**
 * Resolves a role by name, creating it on first use.
 *
 * Roles are normally provisioned by the seed script, but OTP-based signup can
 * create a user before the seeder has ever run, so registration paths must not
 * assume the row exists.
 */
export const findOrCreateRole = async (name: UserRoleName) => {
    const existing = await prismaClient.role.findUnique({ where: { name } });
    if (existing) return existing;

    return prismaClient.role.create({
        data: { name, description: ROLE_DESCRIPTIONS[name] ?? name },
    });
};

/**
 * Returns the `Drivers` row id for a user, or null when the user has no driver
 * profile. `Bookings.driverId` and `Conversations.driverId` reference
 * `Drivers.id`, while the authenticated principal is a `Users` row - mixing the
 * two up silently returns empty result sets.
 */
export const getDriverIdForUser = async (userId: string): Promise<string | null> => {
    const driver = await prismaClient.drivers.findUnique({
        where: { userId },
        select: { id: true },
    });
    return driver?.id ?? null;
};

/**
 * Builds the user object embedded in the JWT. Permissions are flattened to names
 * so `requirePermission` never receives Prisma objects.
 */
export const buildTokenUser = <T extends { role?: unknown }>(user: T) => {
    const role = user.role as
        | (Record<string, unknown> & { permissions?: unknown })
        | null
        | undefined;

    const permissions = Array.isArray(role?.permissions)
        ? role.permissions
            .map((p) =>
                typeof p === "string"
                    ? p
                    : (p as { name?: unknown })?.name
            )
            .filter((p): p is string => typeof p === "string")
        : [];

    const { password: _password, twoFactorSecret: _secret, otpCode: _otpCode, ...safe } =
        user as Record<string, unknown>;

    return {
        ...safe,
        role: role
            ? { id: role.id, name: role.name, description: role.description, permissions }
            : null,
    };
};