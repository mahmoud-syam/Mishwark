import { randomInt } from "crypto";
import { hashSync } from "bcrypt";
import { z } from "zod";
import prismaClient from "../utils/prismaClientHelper";
import { BadRequestException, ConflictException, NotFoundException } from "../utils/errors";
import { ADMIN_ROLE_NAMES, USER_ROLES } from "../constants/roles";
import { findOrCreateRole } from "./role.service";

/**
 * Dashboard team accounts (Admin and Super Admin), managed by a Super Admin
 * from the Team page. A new account gets a temporary password that must be
 * replaced at the first sign-in, then 2FA is set up (mandatory). When someone
 * loses their phone or password, the Super Admin resets it here.
 */
export const TEAM_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const teamCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().email().max(120),
    role: z.enum(TEAM_ROLES),
  })
  .strict();
export const teamRoleSchema = z.object({ role: z.enum(TEAM_ROLES) }).strict();

// No look-alike characters (0/O, 1/l/I), so a password read aloud or copied by hand works.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export const temporaryPassword = () => {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)];
  const part = () => Array.from({ length: 4 }, pick).join("");
  return `${part()}-${part()}-${part()}`;
};

const memberSelect = {
  id: true,
  name: true,
  email: true,
  twoFactorEnabled: true,
  mustChangePassword: true,
  lastLoginAt: true,
  disabledAt: true,
  createdAt: true,
  role: { select: { name: true } },
} as const;

type MemberRow = {
  id: string;
  name: string;
  email: string | null;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  role: { name: string };
};

const shape = (m: MemberRow) => ({
  id: m.id,
  name: m.name,
  email: m.email,
  role: m.role.name as TeamRole,
  twoFactorEnabled: m.twoFactorEnabled,
  mustChangePassword: m.mustChangePassword,
  lastLoginAt: m.lastLoginAt,
  disabledAt: m.disabledAt,
  createdAt: m.createdAt,
});

export default class TeamService {
  public static async list() {
    const rows = await prismaClient.users.findMany({
      where: { isDeleted: false, role: { name: { in: [...ADMIN_ROLE_NAMES] } } },
      select: memberSelect,
      orderBy: [{ createdAt: "asc" }],
    });
    // Active accounts first (Super Admins, then admins), disabled ones last; each by creation date.
    const rank = (m: ReturnType<typeof shape>) => (m.disabledAt ? 2 : m.role === USER_ROLES.SUPER_ADMIN ? 0 : 1);
    return rows.map(shape).sort((a, b) => rank(a) - rank(b));
  }

  /** A team member other than the one acting. */
  private static async member(id: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException("You can't change your own account from the Team page");
    }
    const m = await prismaClient.users.findFirst({
      where: { id, isDeleted: false, role: { name: { in: [...ADMIN_ROLE_NAMES] } } },
      select: memberSelect,
    });
    if (!m) throw new NotFoundException("Team member not found");
    return m;
  }

  public static async create(input: z.infer<typeof teamCreateSchema>) {
    const taken = await prismaClient.users.findUnique({ where: { email: input.email }, select: { id: true } });
    if (taken) throw new ConflictException("This email is already used by another account");
    const role = await findOrCreateRole(input.role);
    const password = temporaryPassword();
    const m = await prismaClient.users.create({
      data: {
        name: input.name,
        email: input.email,
        password: hashSync(password, 10),
        mustChangePassword: true,
        roleId: role.id,
      },
      select: memberSelect,
    });
    return { member: shape(m), temporaryPassword: password };
  }

  /** Lost phone: 2FA is set up again at the next sign-in; current sessions end. */
  public static async reset2FA(id: string, actorId: string) {
    const m = await this.member(id, actorId);
    await prismaClient.users.update({
      where: { id },
      data: { twoFactorEnabled: false, twoFactorSecret: "", tokenVersion: { increment: 1 } },
    });
    return shape({ ...m, twoFactorEnabled: false });
  }

  /** Forgotten password: a new temporary one, replaced at the next sign-in; current sessions end. */
  public static async resetPassword(id: string, actorId: string) {
    const m = await this.member(id, actorId);
    const password = temporaryPassword();
    await prismaClient.users.update({
      where: { id },
      data: { password: hashSync(password, 10), mustChangePassword: true, tokenVersion: { increment: 1 } },
    });
    return { member: shape({ ...m, mustChangePassword: true }), temporaryPassword: password };
  }

  /**
   * Someone left: signed out everywhere and can't sign in; history and audit
   * entries stay. Any account but your own, so an active Super Admin (you)
   * always remains.
   */
  public static async disable(id: string, actorId: string) {
    const m = await this.member(id, actorId);
    if (m.disabledAt) return shape(m);
    const disabledAt = new Date();
    await prismaClient.users.update({ where: { id }, data: { disabledAt, tokenVersion: { increment: 1 } } });
    return shape({ ...m, disabledAt });
  }

  public static async enable(id: string, actorId: string) {
    const m = await this.member(id, actorId);
    if (!m.disabledAt) return shape(m);
    await prismaClient.users.update({ where: { id }, data: { disabledAt: null } });
    return shape({ ...m, disabledAt: null });
  }

  /** New role applies right away: current sessions end so permissions are re-read. */
  public static async setRole(id: string, actorId: string, role: TeamRole) {
    const m = await this.member(id, actorId);
    if (m.role.name === role) return { member: shape(m), from: role };
    const r = await findOrCreateRole(role);
    await prismaClient.users.update({ where: { id }, data: { roleId: r.id, tokenVersion: { increment: 1 } } });
    return { member: shape({ ...m, role: { name: role } }), from: m.role.name };
  }
}
