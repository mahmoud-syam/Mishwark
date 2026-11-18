-- One review per trip in each direction. Reviews sent at the same moment could
-- both be saved; keep the first of any such duplicates, then enforce it.
DELETE FROM "Reviews" r
USING "Reviews" older
WHERE r."bookingId" = older."bookingId"
  AND r."reviewerType" = older."reviewerType"
  AND (r."createdAt", r.id) > (older."createdAt", older.id);

CREATE UNIQUE INDEX "Reviews_bookingId_reviewerType_key" ON "Reviews"("bookingId", "reviewerType");
