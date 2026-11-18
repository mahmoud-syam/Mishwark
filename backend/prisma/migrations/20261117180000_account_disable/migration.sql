-- A Super Admin can disable a team account (someone who left): signed out
-- everywhere and can't sign in, history kept, can be enabled again.
ALTER TABLE "Users" ADD COLUMN "disabledAt" TIMESTAMP(3);
