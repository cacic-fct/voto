CREATE TABLE "RevokedVotingSubject" (
    "subjectHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RevokedVotingSubject_pkey" PRIMARY KEY ("subjectHash")
);

CREATE TYPE "VotingDeletionState" AS ENUM ('PENDING', 'CANCELLED', 'COMPLETED');

CREATE TABLE "VotingDeletionRequest" (
    "requestHash" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "state" "VotingDeletionState" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VotingDeletionRequest_pkey" PRIMARY KEY ("requestHash")
);
CREATE INDEX "VotingDeletionRequest_subjectHash_idx" ON "VotingDeletionRequest"("subjectHash");

CREATE TABLE "PollObjectDeletion" (
    "objectKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PollObjectDeletion_pkey" PRIMARY KEY ("objectKey")
);
CREATE INDEX "PollObjectDeletion_nextAttemptAt_idx" ON "PollObjectDeletion"("nextAttemptAt");

ALTER TABLE "CacicElectionSlateMember" ADD COLUMN "verifiedSubjectHash" TEXT;
CREATE INDEX "CacicElectionSlateMember_verifiedSubjectHash_idx" ON "CacicElectionSlateMember"("verifiedSubjectHash");

CREATE TABLE "PollAdminAudit" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "beforeVersion" TIMESTAMP(3),
    "afterVersion" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PollAdminAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PollAdminAudit_pollId_createdAt_idx" ON "PollAdminAudit"("pollId", "createdAt");
CREATE INDEX "PollAdminAudit_actorId_idx" ON "PollAdminAudit"("actorId");

ALTER TABLE "PollAdminAudit" ADD CONSTRAINT "PollAdminAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
