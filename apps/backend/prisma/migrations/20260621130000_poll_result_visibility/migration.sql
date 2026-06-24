ALTER TABLE "Poll" ADD COLUMN "resultsPublic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Poll" ADD COLUMN "resultsLive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PollResponse" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "PollResponse_pollId_createdAt_idx" ON "PollResponse"("pollId", "createdAt");
