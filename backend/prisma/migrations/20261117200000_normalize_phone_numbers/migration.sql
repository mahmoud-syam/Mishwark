-- Phone numbers are stored in one format (+20… for Egyptian mobiles), so the
-- same person can't sign up twice as 010… and +2010…. Numbers whose +20 form
-- already belongs to another account are left as they are (merge by hand).
UPDATE "Users" u SET "phoneNumber" = '+2' || u."phoneNumber"
WHERE u."phoneNumber" ~ '^01[0-9]{9}$'
  AND NOT EXISTS (SELECT 1 FROM "Users" o WHERE o."phoneNumber" = '+2' || u."phoneNumber");

UPDATE "Users" u SET "phoneNumber" = '+' || u."phoneNumber"
WHERE u."phoneNumber" ~ '^201[0-9]{9}$'
  AND NOT EXISTS (SELECT 1 FROM "Users" o WHERE o."phoneNumber" = '+' || u."phoneNumber");
