-- Store CACiC election slate member enrollment numbers so public ballot cards can show derived admission year only.
ALTER TABLE "CacicElectionSlateMember" ADD COLUMN "enrollmentNumber" TEXT;
