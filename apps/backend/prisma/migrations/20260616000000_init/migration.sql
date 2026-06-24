-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PollElementType" AS ENUM (
    'SECTION',
    'STATEMENT',
    'SHORT_TEXT',
    'LONG_TEXT',
    'SINGLE_CHOICE',
    'MULTIPLE_CHOICE'
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "preferredUsername" TEXT,
    "email" TEXT,
    "name" TEXT,
    "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "claims" JSONB,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "PollStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "updatedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollElement" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "type" "PollElementType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PollElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollElementOption" (
    "id" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PollElementOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollResponse" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "userId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollAnswer" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "PollAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Poll_status_idx" ON "Poll"("status");

-- CreateIndex
CREATE INDEX "Poll_createdAt_idx" ON "Poll"("createdAt");

-- CreateIndex
CREATE INDEX "PollElement_pollId_position_idx" ON "PollElement"("pollId", "position");

-- CreateIndex
CREATE INDEX "PollElementOption_elementId_position_idx" ON "PollElementOption"("elementId", "position");

-- CreateIndex
CREATE INDEX "PollResponse_pollId_submittedAt_idx" ON "PollResponse"("pollId", "submittedAt");

-- CreateIndex
CREATE INDEX "PollResponse_userId_idx" ON "PollResponse"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PollAnswer_responseId_elementId_key" ON "PollAnswer"("responseId", "elementId");

-- CreateIndex
CREATE INDEX "PollAnswer_elementId_idx" ON "PollAnswer"("elementId");

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollElement" ADD CONSTRAINT "PollElement_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollElementOption" ADD CONSTRAINT "PollElementOption_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "PollElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollResponse" ADD CONSTRAINT "PollResponse_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollResponse" ADD CONSTRAINT "PollResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollAnswer" ADD CONSTRAINT "PollAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "PollResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollAnswer" ADD CONSTRAINT "PollAnswer_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "PollElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
