/**
 * First start of a real (production) database. Safe to run again: it changes
 * nothing that already exists.
 *
 * - Roles and permissions (same as `npm run seed:api`).
 * - The settings row with its defaults (prices and rules are then set from the
 *   dashboard).
 * - One Super Admin, only if there is none yet, from ADMIN_EMAIL, ADMIN_NAME
 *   and ADMIN_PHONE. It gets a temporary password printed here once: the first
 *   sign-in asks for a new password, then sets up 2FA.
 *
 * Unlike `npm run seed` it creates no test accounts, cars or drivers, and no
 * known password.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your name" ADMIN_PHONE=+2010... \
 *     npx tsx prisma/seed/production.ts
 */
import "dotenv/config";
import { randomInt } from "crypto";
import { hashSync } from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { seedRolesAndPermissions } from "./api_seed_roles";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export const temporaryPassword = () => {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${part()}-${part()}-${part()}`;
};

export async function bootstrapProduction(
  connectionString: string,
  admin: { email?: string; name?: string; phone?: string },
  log: (s: string) => void = (s) => console.log(s)
) {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await seedRolesAndPermissions();
    await prisma.systemSettings.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });

    const superRole = await prisma.role.findUnique({ where: { name: "SUPER_ADMIN" } });
    if (!superRole) throw new Error("SUPER_ADMIN role is missing after seeding roles.");
    const existing = await prisma.users.findFirst({ where: { roleId: superRole.id, isDeleted: false }, select: { email: true } });
    if (existing) {
      log(`A Super Admin already exists (${existing.email}). Nothing else to do.`);
      return { created: false as const };
    }

    const email = admin.email?.trim().toLowerCase();
    const name = admin.name?.trim();
    const phone = admin.phone?.trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Set ADMIN_EMAIL to the Super Admin's email.");
    if (!name || name.length < 2) throw new Error("Set ADMIN_NAME to the Super Admin's name.");
    if (phone && !/^\+\d{8,15}$/.test(phone)) throw new Error("ADMIN_PHONE must look like +201001234567 (or leave it empty).");

    const password = temporaryPassword();
    const settings = await prisma.systemSettings.findUnique({ where: { id: "global" } });
    await prisma.users.create({
      data: {
        name,
        email,
        phoneNumber: phone || null,
        password: hashSync(password, 10),
        roleId: superRole.id,
        mustChangePassword: true,
        tempPasswordExpiresAt: new Date(Date.now() + (settings?.tempPasswordDays ?? 7) * 86_400_000),
      },
    });
    log("");
    log("Super Admin created.");
    log(`  Email:              ${email}`);
    log(`  Temporary password: ${password}`);
    log("Sign in at /dashboard/ with these; you'll choose your own password, then set up 2FA.");
    log("This password is shown only now and isn't stored anywhere in plain text.");
    log("");
    return { created: true as const, email, password };
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  bootstrapProduction(url, { email: process.env.ADMIN_EMAIL, name: process.env.ADMIN_NAME, phone: process.env.ADMIN_PHONE })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
