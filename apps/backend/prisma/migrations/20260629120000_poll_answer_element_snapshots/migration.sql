ALTER TABLE "PollElement" ADD COLUMN "retiredAt" TIMESTAMP(3);
ALTER TABLE "PollAnswer" ADD COLUMN "elementSnapshot" JSONB;

CREATE INDEX "PollElement_pollId_retiredAt_position_idx" ON "PollElement"("pollId", "retiredAt", "position");
