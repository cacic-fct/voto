-- Add request-time publication and voting windows for polls.
ALTER TABLE "Poll" ADD COLUMN "visibleFrom" TIMESTAMP(3);
ALTER TABLE "Poll" ADD COLUMN "votingStartsAt" TIMESTAMP(3);
ALTER TABLE "Poll" ADD COLUMN "votingEndsAt" TIMESTAMP(3);

CREATE INDEX "Poll_status_visibleFrom_idx" ON "Poll"("status", "visibleFrom");
CREATE INDEX "Poll_status_votingStartsAt_votingEndsAt_idx" ON "Poll"("status", "votingStartsAt", "votingEndsAt");
