-- Add CACiC election mode and slate staging/review support.
CREATE TYPE "PollMode" AS ENUM ('REGULAR', 'CACIC_ELECTION');
CREATE TYPE "CacicElectionPhase" AS ENUM ('SLATE_SUBMISSION', 'ELECTION');
CREATE TYPE "CacicElectionSlateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "CacicElectionSlateSubmissionSource" AS ENUM ('PUBLIC', 'ADMIN');
CREATE TYPE "CacicElectionSlateMemberRole" AS ENUM (
    'PRESIDENT',
    'VICE_PRESIDENT',
    'FINANCIAL_DIRECTOR',
    'COMMUNICATION_DIRECTOR',
    'EVENTS_DIRECTOR',
    'PUBLIC_RELATIONS_DIRECTOR',
    'OTHER'
);
CREATE TYPE "CacicElectionSlateMemberIdentifierType" AS ENUM ('CPF', 'PHONE', 'EMAIL');

ALTER TABLE "Poll" ADD COLUMN "mode" "PollMode" NOT NULL DEFAULT 'REGULAR';
ALTER TABLE "Poll" ADD COLUMN "cacicElectionPhase" "CacicElectionPhase";

CREATE TABLE "CacicElectionSlate" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CacicElectionSlateStatus" NOT NULL DEFAULT 'PENDING',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rejectionReason" TEXT,
    "submissionSource" "CacicElectionSlateSubmissionSource" NOT NULL DEFAULT 'PUBLIC',
    "submittedById" TEXT,
    "adminCreatedById" TEXT,
    "reviewedById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CacicElectionSlate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CacicElectionSlateMember" (
    "id" TEXT NOT NULL,
    "slateId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "CacicElectionSlateMemberRole" NOT NULL,
    "customRole" TEXT,
    "isRepresentative" BOOLEAN NOT NULL DEFAULT false,
    "identifierType" "CacicElectionSlateMemberIdentifierType" NOT NULL,
    "identifierValue" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CacicElectionSlateMember_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Poll_mode_cacicElectionPhase_idx" ON "Poll"("mode", "cacicElectionPhase");
CREATE UNIQUE INDEX "CacicElectionSlate_pollId_submittedById_key" ON "CacicElectionSlate"("pollId", "submittedById");
CREATE INDEX "CacicElectionSlate_pollId_status_enabled_idx" ON "CacicElectionSlate"("pollId", "status", "enabled");
CREATE INDEX "CacicElectionSlate_submittedById_idx" ON "CacicElectionSlate"("submittedById");
CREATE INDEX "CacicElectionSlate_adminCreatedById_idx" ON "CacicElectionSlate"("adminCreatedById");
CREATE INDEX "CacicElectionSlate_reviewedById_idx" ON "CacicElectionSlate"("reviewedById");
CREATE INDEX "CacicElectionSlate_submittedAt_idx" ON "CacicElectionSlate"("submittedAt");
CREATE INDEX "CacicElectionSlateMember_slateId_position_idx" ON "CacicElectionSlateMember"("slateId", "position");

ALTER TABLE "CacicElectionSlate" ADD CONSTRAINT "CacicElectionSlate_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CacicElectionSlate" ADD CONSTRAINT "CacicElectionSlate_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CacicElectionSlate" ADD CONSTRAINT "CacicElectionSlate_adminCreatedById_fkey" FOREIGN KEY ("adminCreatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CacicElectionSlate" ADD CONSTRAINT "CacicElectionSlate_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CacicElectionSlateMember" ADD CONSTRAINT "CacicElectionSlateMember_slateId_fkey" FOREIGN KEY ("slateId") REFERENCES "CacicElectionSlate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
