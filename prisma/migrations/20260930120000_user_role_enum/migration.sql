-- Constrain Role.name to the canonical UserRole enum, backfill role-less users,
-- and make Users.roleId mandatory.
--
-- Previous state allowed arbitrary-cased role names ("Super Admin", "super admin",
-- "admin", ...) and a NULL roleId. Because role comparisons were done with
-- inconsistent string literals, this produced parallel role sets and users who
-- silently bypassed every role check.

-- ---------------------------------------------------------------------------
-- 1. Ensure the four canonical roles exist before anything references them.
-- ---------------------------------------------------------------------------
INSERT INTO "Role" ("id", "name", "description", "createdAt", "updatedAt")
VALUES
    (gen_random_uuid()::text, 'SUPER_ADMIN', 'Super Administrator with full system access', NOW(), NOW()),
    (gen_random_uuid()::text, 'ADMIN',       'System Administrator',                          NOW(), NOW()),
    (gen_random_uuid()::text, 'CUSTOMER',    'Customer Account',                              NOW(), NOW()),
    (gen_random_uuid()::text, 'DRIVER',      'Driver Account',                                NOW(), NOW())
ON CONFLICT ("name") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Map every existing role onto its canonical UPPER_SNAKE equivalent.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE role_map AS
SELECT id, UPPER(REPLACE(TRIM(name), ' ', '_')) AS canon_name
FROM "Role";

-- ---------------------------------------------------------------------------
-- 3. Pick one surviving row per canonical name, preferring an exact match.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE role_canonical AS
SELECT canon_name, MIN(id) AS canonical_id
FROM (
    SELECT
        rm.canon_name,
        rm.id,
        ROW_NUMBER() OVER (
            PARTITION BY rm.canon_name
            ORDER BY (r.name = rm.canon_name) DESC, rm.id
        ) AS rn
    FROM role_map rm
    JOIN "Role" r ON r.id = rm.id
) t
WHERE t.rn = 1
GROUP BY t.canon_name;

-- ---------------------------------------------------------------------------
-- 4. Re-point users on duplicate rows at the canonical role, then drop them.
--    (Users.roleId is still nullable and its FK is ON DELETE SET NULL here, so
--    users would otherwise fall back to a NULL role.)
-- ---------------------------------------------------------------------------
UPDATE "Users" u
SET "roleId" = rc.canonical_id
FROM role_map rm
JOIN role_canonical rc ON rc.canon_name = rm.canon_name
WHERE u."roleId" = rm.id
  AND rm.id <> rc.canonical_id;

-- ---------------------------------------------------------------------------
-- 5. Merge permissions from duplicates into the canonical role.
--    _RolePermissions has PRIMARY KEY ("A","B") so re-inserts are no-ops.
-- ---------------------------------------------------------------------------
INSERT INTO "_RolePermissions" ("A", "B")
SELECT rp."A", rc.canonical_id
FROM role_map rm
JOIN role_canonical rc ON rc.canon_name = rm.canon_name
JOIN "_RolePermissions" rp ON rp."B" = rm.id
WHERE rm.id <> rc.canonical_id
ON CONFLICT ("A", "B") DO NOTHING;

DELETE FROM "Role" r
USING role_map rm
JOIN role_canonical rc ON rc.canon_name = rm.canon_name
WHERE r.id = rm.id
  AND rm.id <> rc.canonical_id;

-- ---------------------------------------------------------------------------
-- 6. Backfill every role-less user as a Customer.
-- ---------------------------------------------------------------------------
UPDATE "Users" u
SET "roleId" = (SELECT id FROM "Role" WHERE name = 'CUSTOMER')
WHERE u."roleId" IS NULL;

-- ---------------------------------------------------------------------------
-- 7. Collapse any non-canonical leftovers that have no canonical counterpart.
--    CUSTOMER is the catch-all so the step-6 backfill above always resolves.
-- ---------------------------------------------------------------------------
UPDATE "Role" SET name = 'CUSTOMER'
WHERE name::text NOT IN ('SUPER_ADMIN', 'ADMIN', 'CUSTOMER', 'DRIVER')
  AND NOT EXISTS (SELECT 1 FROM "Role" c WHERE c.name = 'CUSTOMER');

-- ---------------------------------------------------------------------------
-- 8. Convert name to the enum.
-- ---------------------------------------------------------------------------
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'CUSTOMER', 'DRIVER');

ALTER TABLE "Role" ALTER COLUMN "name" DROP DEFAULT;
ALTER TABLE "Role"
    ALTER COLUMN "name" TYPE "UserRole" USING ("name"::text)::"UserRole";

-- ---------------------------------------------------------------------------
-- 9. roleId is now mandatory. The FK must stop cascading to NULL.
-- ---------------------------------------------------------------------------
ALTER TABLE "Users" ALTER COLUMN "roleId" SET NOT NULL;

ALTER TABLE "Users"
    DROP CONSTRAINT "Users_roleId_fkey",
    ADD CONSTRAINT "Users_roleId_fkey"
        FOREIGN KEY ("roleId") REFERENCES "Role"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 10. A user code is only unique when actually set. OTP-created users all share
--     the legacy default of '', so a plain unique index would collide.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "Users_code_key" ON "Users"("code") WHERE "code" <> '';

DROP TABLE role_map;
DROP TABLE role_canonical;