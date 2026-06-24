-- Additive schema support for poll eligibility through a shareable direct link.
ALTER TABLE "Poll" ADD COLUMN "directLinkEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Poll" ADD COLUMN "directLinkToken" TEXT;

CREATE UNIQUE INDEX "Poll_directLinkToken_key" ON "Poll"("directLinkToken");
