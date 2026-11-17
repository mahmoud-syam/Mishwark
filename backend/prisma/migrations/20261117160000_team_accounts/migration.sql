-- Team accounts on the dashboard: a Super Admin creates an account with a
-- temporary password that must be changed at first sign-in, and can see when
-- each member last signed in.
ALTER TABLE "Users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Users" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
