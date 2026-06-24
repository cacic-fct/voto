-- CreateEnum
CREATE TYPE "PollVotingStyle" AS ENUM ('PUBLIC', 'PARTIALLY_SECRET', 'SECRET', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "PollVoterEligibilitySource" AS ENUM ('AUTHENTICATED_USERS', 'EVENT_ATTENDANCE');

-- AlterTable
ALTER TABLE "Poll"
ADD COLUMN "votingStyle" "PollVotingStyle" NOT NULL DEFAULT 'SECRET',
ADD COLUMN "voterEligibilitySource" "PollVoterEligibilitySource" NOT NULL DEFAULT 'AUTHENTICATED_USERS';

-- Preserve existing event-attendance restrictions as the first eligibility source.
UPDATE "Poll"
SET "voterEligibilitySource" = 'EVENT_ATTENDANCE'
WHERE "restrictVotingToEventAttendees" = true;

-- AlterTable
ALTER TABLE "Poll" DROP COLUMN "restrictVotingToEventAttendees";

-- AlterTable
ALTER TABLE "PollResponse" ALTER COLUMN "submittedAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PollVoter" (
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PollVoter_pkey" PRIMARY KEY ("pollId","userId")
);

-- Preserve voter registry for existing authenticated responses.
INSERT INTO "PollVoter" ("pollId", "userId")
SELECT DISTINCT "pollId", "userId"
FROM "PollResponse"
WHERE "userId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "PollVoter_userId_idx" ON "PollVoter"("userId");

-- AddForeignKey
ALTER TABLE "PollVoter" ADD CONSTRAINT "PollVoter_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVoter" ADD CONSTRAINT "PollVoter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
