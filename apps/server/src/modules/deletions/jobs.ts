import { randomUUID } from 'node:crypto';
import { pool } from '../../platform/clients.ts';
import { transaction } from '../editing/transaction.ts';
import { enqueueWork } from '../uploads/outbox.ts';
import type { DeletionRow } from './model.ts';

export async function acquireDeletion(id: string) {
  return transaction(async (db) => {
    const {
      rows: [job],
    } = await db.query<DeletionRow & { eligible: boolean }>(
      `SELECT *, CASE WHEN status = 'PROCESSING' THEN "leaseUntil" <= clock_timestamp()
        ELSE "nextAttemptAt" IS NULL OR "nextAttemptAt" <= clock_timestamp() END AS eligible
       FROM "Deletion" WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!job || !['PENDING', 'PROCESSING'].includes(job.status) || !job.eligible) return null;
    if (job.attemptCount >= 3) {
      await db.query(
        `UPDATE "Deletion" SET status = 'FAILED',"errorCode" = 'CLEANUP_FAILED',
         "attemptId" = NULL,"leaseUntil" = NULL,"updatedAt" = now() WHERE id = $1`,
        [id],
      );
      return null;
    }
    const waiting = await db.query(
      `SELECT 1 FROM "Upload" u JOIN "Resource" r ON r.id = u."resourceRefId"
       WHERE r."deletionId" = $1 AND (u.status NOT IN ('COMPLETED','FAILED','CANCELLED')
         OR u."cleanupPending") LIMIT 1`,
      [id],
    );
    if (waiting.rowCount) {
      const {
        rows: [next],
      } = await db.query<{ nextAttemptAt: Date }>(
        `UPDATE "Deletion" SET status = 'PENDING',"attemptId" = NULL,"leaseUntil" = NULL,
          "nextAttemptAt" = clock_timestamp() + interval '5 seconds',"updatedAt" = now()
         WHERE id = $1 RETURNING "nextAttemptAt"`,
        [id],
      );
      await enqueueWork(db, 'DELETE', id, next.nextAttemptAt);
      return null;
    }
    const attemptId = randomUUID();
    await db.query(
      `UPDATE "Deletion" SET status = 'PROCESSING',"attemptCount" = "attemptCount" + 1,
        "attemptId" = $2,"leaseUntil" = clock_timestamp() + interval '60 seconds',
        "nextAttemptAt" = NULL,"updatedAt" = now() WHERE id = $1`,
      [id, attemptId],
    );
    return { id, ownerId: job.ownerId, attemptId };
  });
}

export type DeletionAttempt = NonNullable<Awaited<ReturnType<typeof acquireDeletion>>>;

export async function retryDeletion(attempt: DeletionAttempt) {
  return transaction(async (db) => {
    const {
      rows: [job],
    } = await db.query<{ nextAttemptAt: Date | null }>(
      `UPDATE "Deletion" SET status = CASE WHEN "attemptCount" >= 3 THEN 'FAILED' ELSE 'PENDING' END,
        "errorCode" = CASE WHEN "attemptCount" >= 3 THEN 'CLEANUP_FAILED' ELSE NULL END,
        "nextAttemptAt" = CASE WHEN "attemptCount" >= 3 THEN NULL ELSE clock_timestamp() +
          CASE WHEN "attemptCount" = 1 THEN interval '5 seconds' ELSE interval '20 seconds' END END,
        "attemptId" = NULL,"leaseUntil" = NULL,"updatedAt" = now()
       WHERE id = $1 AND "attemptId" = $2 AND status = 'PROCESSING'
       RETURNING "nextAttemptAt"`,
      [attempt.id, attempt.attemptId],
    );
    if (job?.nextAttemptAt) await enqueueWork(db, 'DELETE', attempt.id, job.nextAttemptAt);
  });
}

export async function wakeDeletions() {
  await pool.query(
    `UPDATE "Outbox" o SET "publishedAt" = NULL,"availableAt" = clock_timestamp(),
      "attemptId" = NULL,"leaseUntil" = NULL,"errorCode" = NULL
     FROM (SELECT d.id FROM "Deletion" d JOIN "Outbox" pending
       ON pending."entityId" = d.id AND pending.type = 'DELETE'
       WHERE ((d.status = 'PENDING' AND
         (d."nextAttemptAt" IS NULL OR d."nextAttemptAt" <= clock_timestamp()))
         OR (d.status = 'PROCESSING' AND d."leaseUntil" <= clock_timestamp()))
         AND pending."publishedAt" < clock_timestamp() - interval '60 seconds'
       ORDER BY d."updatedAt" LIMIT 20 FOR UPDATE OF d SKIP LOCKED) due
     WHERE o."entityId" = due.id AND o.type = 'DELETE'`,
  );
}

export async function resumeFailedDeletion(id: string): Promise<boolean> {
  return transaction(async (db) => {
    const result = await db.query(
      `UPDATE "Deletion" SET status = 'PENDING',"attemptCount" = 0,"errorCode" = NULL,
        "nextAttemptAt" = NULL,"attemptId" = NULL,"leaseUntil" = NULL,"updatedAt" = now()
       WHERE id = $1 AND status = 'FAILED' RETURNING id`,
      [id],
    );
    if (result.rowCount) await enqueueWork(db, 'DELETE', id);
    return result.rowCount === 1;
  });
}
