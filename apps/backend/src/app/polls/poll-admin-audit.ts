import { Prisma } from '@prisma/client';

/** Keep this allowlist explicit: no request bodies, answers, voters, or member identifiers. */
export async function recordPollAdminAudit(
  tx: Prisma.TransactionClient,
  event: {
    pollId: string;
    actorId?: string;
    action: string;
    beforeVersion?: Date;
    afterVersion?: Date;
  },
): Promise<void> {
  await tx.pollAdminAudit.create({
    data: {
      pollId: event.pollId,
      actorId: event.actorId ?? null,
      action: event.action,
      beforeVersion: event.beforeVersion ?? null,
      afterVersion: event.afterVersion ?? null,
    },
  });
}
