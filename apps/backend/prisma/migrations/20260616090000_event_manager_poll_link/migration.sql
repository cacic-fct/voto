ALTER TABLE "Poll"
ADD COLUMN "linkedEventId" TEXT,
ADD COLUMN "linkedEventName" TEXT,
ADD COLUMN "linkedEventStartDate" TIMESTAMP(3),
ADD COLUMN "linkedEventEndDate" TIMESTAMP(3),
ADD COLUMN "linkedEventLocationDescription" TEXT,
ADD COLUMN "restrictVotingToEventAttendees" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Poll_linkedEventId_idx" ON "Poll"("linkedEventId");
