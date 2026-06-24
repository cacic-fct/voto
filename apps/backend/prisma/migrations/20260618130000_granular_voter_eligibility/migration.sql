-- Add finer-grained voting eligibility sources and the optional document-verified Unesp role requirement.
ALTER TYPE "PollVoterEligibilitySource" ADD VALUE IF NOT EXISTS 'UNESP_USERS';
ALTER TYPE "PollVoterEligibilitySource" ADD VALUE IF NOT EXISTS 'COMPUTER_SCIENCE_STUDENTS';
ALTER TYPE "PollVoterEligibilitySource" ADD VALUE IF NOT EXISTS 'EVENT_ATTENDANCE_UNESP_USERS';
ALTER TYPE "PollVoterEligibilitySource" ADD VALUE IF NOT EXISTS 'EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS';

ALTER TABLE "Poll"
ADD COLUMN "requireVerifiedUnespRole" BOOLEAN NOT NULL DEFAULT false;
