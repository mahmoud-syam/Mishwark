import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { PERMISSIONS, USER_ROLES } from "../../src/v1/constants/roles";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/mishwarak";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export const permissionsData = [
  { name: PERMISSIONS.DASHBOARD_VIEW, description: "View Admin Dashboard statistics" },
  { name: PERMISSIONS.USER_MANAGE, description: "Manage users and profiles" },
  { name: PERMISSIONS.ROLE_MANAGE, description: "Manage roles and permissions" },
  { name: PERMISSIONS.BOOKING_MANAGE, description: "Manage trip bookings" },
  { name: PERMISSIONS.VEHICLE_MANAGE, description: "Manage vehicles and availability" },
  { name: PERMISSIONS.DRIVER_MANAGE, description: "Manage driver profiles and status" },
  { name: PERMISSIONS.PAYMENT_MANAGE, description: "Manage payments and transactions" },
  { name: PERMISSIONS.SETTINGS_MANAGE, description: "Manage global system settings" },
  { name: PERMISSIONS.REVIEW_MANAGE, description: "Manage customer and driver reviews" },
  { name: PERMISSIONS.WALLET_MANAGE, description: "Credit, debit and adjust customer wallets" },
  { name: PERMISSIONS.USER_PASSWORD_MANAGE, description: "Reset another user's password or 2FA" },
];

export const rolesData = [
  { name: USER_ROLES.SUPER_ADMIN, description: "Super Administrator with full system access" },
  { name: USER_ROLES.ADMIN, description: "System Administrator" },
  { name: USER_ROLES.CUSTOMER, description: "Customer Account" },
  { name: USER_ROLES.DRIVER, description: "Driver Account" },
];

/** Every permission except the two reserved for Super Admin. */
const ADMIN_PERMISSIONS = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.USER_MANAGE,
  PERMISSIONS.BOOKING_MANAGE,
  PERMISSIONS.VEHICLE_MANAGE,
  PERMISSIONS.DRIVER_MANAGE,
  PERMISSIONS.PAYMENT_MANAGE,
  PERMISSIONS.REVIEW_MANAGE,
  PERMISSIONS.WALLET_MANAGE,
  PERMISSIONS.USER_PASSWORD_MANAGE,
];

export async function seedRolesAndPermissions() {
  try {
    console.log("Seeding permissions...");
    for (const perm of permissionsData) {
      await prisma.permission.upsert({
        where: { name: perm.name },
        update: { description: perm.description },
        create: perm,
      });
    }

    console.log("Seeding roles...");
    for (const role of rolesData) {
      await prisma.role.upsert({
        where: { name: role.name },
        update: { description: role.description },
        create: role,
      });
    }

    // Assign permissions to roles
    const allPermissions = await prisma.permission.findMany();
    const superAdminRole = await prisma.role.findUnique({ where: { name: USER_ROLES.SUPER_ADMIN } });
    if (superAdminRole && allPermissions.length > 0) {
      await prisma.role.update({
        where: { id: superAdminRole.id },
        data: {
          permissions: {
            set: allPermissions.map((p) => ({ id: p.id })),
          },
        },
      });
    }

    const adminRole = await prisma.role.findUnique({ where: { name: USER_ROLES.ADMIN } });
    if (adminRole) {
      const adminPerms = allPermissions.filter((p) => ADMIN_PERMISSIONS.includes(p.name as never));
      await prisma.role.update({
        where: { id: adminRole.id },
        data: {
          permissions: {
            set: adminPerms.map((p) => ({ id: p.id })),
          },
        },
      });
    }

    // Customer and Driver intentionally hold no administrative permissions.
    // They are authorized by role, not by permission (see booking.service and
    // chat.controller).
    for (const name of [USER_ROLES.CUSTOMER, USER_ROLES.DRIVER]) {
      const role = await prisma.role.findUnique({ where: { name } });
      if (role) {
        await prisma.role.update({
          where: { id: role.id },
          data: { permissions: { set: [] } },
        });
      }
    }

    console.log("Roles and permissions seeded successfully.");
  } catch (error) {
    console.error("Database connection issue or error during role seeding:", error);
    throw error;
  }
}

if (require.main === module) {
  seedRolesAndPermissions()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}