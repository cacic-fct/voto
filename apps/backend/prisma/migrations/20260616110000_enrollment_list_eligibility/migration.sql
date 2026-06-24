ALTER TYPE "PollVoterEligibilitySource" ADD VALUE IF NOT EXISTS 'ENROLLMENT_LIST';

CREATE TABLE "PollEligibilityEnrollment" (
    "pollId" TEXT NOT NULL,
    "enrollmentNumber" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollEligibilityEnrollment_pkey" PRIMARY KEY ("pollId","enrollmentNumber")
);

CREATE INDEX "PollEligibilityEnrollment_enrollmentNumber_idx" ON "PollEligibilityEnrollment"("enrollmentNumber");

CREATE INDEX "PollEligibilityEnrollment_createdAt_idx" ON "PollEligibilityEnrollment"("createdAt");

ALTER TABLE "PollEligibilityEnrollment"
ADD CONSTRAINT "PollEligibilityEnrollment_pollId_fkey"
FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PollEligibilityEnrollment"
ADD CONSTRAINT "PollEligibilityEnrollment_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
