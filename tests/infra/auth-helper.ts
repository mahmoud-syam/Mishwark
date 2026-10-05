import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../src/secrets';

export interface TestUserRolePayload {
  id?: string;
  name: 'ADMIN' | 'DRIVER' | 'CUSTOMER' | 'SUPER_ADMIN';
  description?: string;
  permissions?: string[];
}

export interface TestUserPayload {
  id: string;
  email: string;
  name?: string;
  code?: string;
  tokenVersion: number;
  roleId?: string;
  role?: TestUserRolePayload | null;
}

const EFFECTIVE_SECRET = JWT_SECRET || process.env.JWT_SECRET || '58232f52e620c21a7820d06348f0829591b2a6ffad3bfc4431248177fc897569';

export function generateToken(
  userPayload: TestUserPayload,
  secret: string = EFFECTIVE_SECRET,
  expiresIn: string = '24h'
): string {
  const payload = {
    user: {
      id: userPayload.id,
      email: userPayload.email,
      name: userPayload.name || 'Test User',
      tokenVersion: userPayload.tokenVersion ?? 0,
      roleId: userPayload.roleId || 'role-id-001',
      role: userPayload.role
        ? {
            id: userPayload.role.id || 'role-id-001',
            name: userPayload.role.name,
            permissions: userPayload.role.permissions || [],
          }
        : null,
    },
  };

  return jwt.sign(payload, secret, { expiresIn: expiresIn as any });
}

export function generateAdminToken(overrides: Partial<TestUserPayload> = {}): string {
  const adminPayload: TestUserPayload = {
    id: overrides.id || 'admin-user-id-001',
    email: overrides.email || 'admin@mishwark.test',
    name: overrides.name || 'Admin User',
    tokenVersion: overrides.tokenVersion ?? 0,
    roleId: overrides.roleId || 'role-admin-001',
    role: {
      id: overrides.role?.id || 'role-admin-001',
      name: 'ADMIN',
      permissions: overrides.role?.permissions || ['*'],
    },
  };

  return generateToken(adminPayload);
}

export function generateDriverToken(overrides: Partial<TestUserPayload> = {}): string {
  const driverPayload: TestUserPayload = {
    id: overrides.id || 'driver-user-id-001',
    email: overrides.email || 'driver@mishwark.test',
    name: overrides.name || 'Driver User',
    tokenVersion: overrides.tokenVersion ?? 0,
    roleId: overrides.roleId || 'role-driver-001',
    role: {
      id: overrides.role?.id || 'role-driver-001',
      name: 'DRIVER',
      permissions: overrides.role?.permissions || ['driver:read', 'driver:write'],
    },
  };

  return generateToken(driverPayload);
}

export function generateRiderToken(overrides: Partial<TestUserPayload> = {}): string {
  const riderPayload: TestUserPayload = {
    id: overrides.id || 'rider-user-id-001',
    email: overrides.email || 'rider@mishwark.test',
    name: overrides.name || 'Rider User',
    tokenVersion: overrides.tokenVersion ?? 0,
    roleId: overrides.roleId || 'role-customer-001',
    role: {
      id: overrides.role?.id || 'role-customer-001',
      name: 'CUSTOMER',
      permissions: overrides.role?.permissions || ['customer:read', 'customer:write'],
    },
  };

  return generateToken(riderPayload);
}

export function generateCustomerToken(overrides: Partial<TestUserPayload> = {}): string {
  return generateRiderToken(overrides);
}

export function generateInvalidToken(): string {
  return 'invalid.jwt.token.string.for.testing';
}

export function generateExpiredToken(userPayload?: Partial<TestUserPayload>): string {
  const basePayload: TestUserPayload = {
    id: userPayload?.id || 'expired-user-id',
    email: userPayload?.email || 'expired@mishwark.test',
    tokenVersion: userPayload?.tokenVersion ?? 0,
    role: {
      name: 'CUSTOMER',
    },
  };

  return generateToken(basePayload, EFFECTIVE_SECRET, '-1s');
}

export function getAuthCookieHeader(token: string): string {
  return `token=${token}`;
}

export function getBearerHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
