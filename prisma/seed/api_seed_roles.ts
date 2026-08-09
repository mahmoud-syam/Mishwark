import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/mishwarak";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export const permissionsData = [
  { name: "dashboard:view", description: "View Admin Dashboard statistics" },
  { name: "user:manage", description: "Manage users and profiles" },
  { name: "role:manage", description: "Manage roles and permissions" },
  { name: "booking:manage", description: "Manage trip bookings" },
  { name: "vehicle:manage", description: "Manage vehicles and availability" },
  { name: "driver:manage", description: "Manage driver profiles and status" },
  { name: "payment:manage", description: "Manage payments and transactions" },
  { name: "settings:manage", description: "Manage global system settings" },
  { name: "review:manage", description: "Manage customer and driver reviews" },
];

export const rolesData = [
  { name: "Super Admin", description: "Super Administrator with full system access" },
  { name: "Admin", description: "System Administrator" },
  { name: "Customer", description: "Customer Account" },
  { name: "Driver", description: "Driver Account" },
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
    const superAdminRole = await prisma.role.findUnique({ where: { name: "Super Admin" } });
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

    const adminRole = await prisma.role.findUnique({ where: { name: "Admin" } });
    if (adminRole) {
      const adminPerms = allPermissions.filter((p) =>
        ["dashboard:view", "user:manage", "booking:manage", "vehicle:manage", "driver:manage", "payment:manage", "review:manage"].includes(p.name)
      );
      await prisma.role.update({
        where: { id: adminRole.id },
        data: {
          permissions: {
            set: adminPerms.map((p) => ({ id: p.id })),
          },
        },
      });
    }

    console.log("Roles and permissions seeded successfully.");
  } catch (error) {
    console.error("Database connection issue or error during role seeding:", error);
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
