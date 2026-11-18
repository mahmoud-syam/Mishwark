-- Complaints the office has dealt with.
ALTER TABLE "Reviews" ADD COLUMN "handledAt" TIMESTAMP(3);
ALTER TABLE "Reviews" ADD COLUMN "handledById" TEXT;
ALTER TABLE "Reviews" ADD COLUMN "handlingNote" TEXT;

ALTER TABLE "Reviews" ADD CONSTRAINT "Reviews_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Reviews_reviewerType_overallRating_handledAt_idx" ON "Reviews"("reviewerType", "overallRating", "handledAt");
CREATE INDEX "Reviews_createdAt_idx" ON "Reviews"("createdAt");
