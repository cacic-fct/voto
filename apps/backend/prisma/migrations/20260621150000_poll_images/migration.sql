-- CreateEnum
CREATE TYPE "PollImagePlacement" AS ENUM ('UNUSED', 'POLL_DESCRIPTION', 'ELEMENT_DESCRIPTION');

-- CreateTable
CREATE TABLE "PollImage" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "placement" "PollImagePlacement" NOT NULL DEFAULT 'UNUSED',
    "elementId" TEXT,
    "objectKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "originalMimeType" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "altText" TEXT,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PollImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PollImage_objectKey_key" ON "PollImage"("objectKey");

-- CreateIndex
CREATE INDEX "PollImage_pollId_placement_position_idx" ON "PollImage"("pollId", "placement", "position");

-- CreateIndex
CREATE INDEX "PollImage_elementId_idx" ON "PollImage"("elementId");

-- CreateIndex
CREATE INDEX "PollImage_createdAt_idx" ON "PollImage"("createdAt");

-- AddForeignKey
ALTER TABLE "PollImage" ADD CONSTRAINT "PollImage_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
