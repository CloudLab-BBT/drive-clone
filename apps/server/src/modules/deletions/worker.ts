import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { lockOwner, transaction } from '../editing/transaction.ts';
import { acquireDeletion, retryDeletion, type DeletionAttempt } from './jobs.ts';

async function cleanObjects(ids: string[]) {
  const { rows } = await pool.query<{ key: string }>(
    `SELECT "objectKey" AS key FROM "Resource" WHERE id = ANY($1::uuid[]) AND "objectKey" IS NOT NULL
     UNION SELECT a."objectKey" FROM "UploadAttempt" a JOIN "Upload" u ON u.id = a."uploadId"
       WHERE u."resourceRefId" = ANY($1::uuid[])`,
    [ids],
  );
  const objects = rows.map(({ key }) => ({ Key: key }));
  for (let offset = 0; offset < objects.length; offset += 1000) {
    const response = await s3.send(
      new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: objects.slice(offset, offset + 1000), Quiet: true },
      }),
      { abortSignal: AbortSignal.timeout(20_000) },
    );
    if (response.Errors?.length) throw new Error('Borrado de objetos incompleto');
  }
}

async function finishBatch(attempt: DeletionAttempt, ids: string[]) {
  return transaction(async (db) => {
    await lockOwner(db, attempt.ownerId);
    const current = await db.query(
      `UPDATE "Deletion" SET "leaseUntil" = clock_timestamp() + interval '60 seconds'
       WHERE id = $1 AND status = 'PROCESSING' AND "attemptId" = $2
         AND "leaseUntil" > clock_timestamp() RETURNING id`,
      [attempt.id, attempt.attemptId],
    );
    if (!current.rowCount) return false;
    await db.query(
      `UPDATE "UploadAttempt" a SET status = 'DISCARDED',"updatedAt" = now()
       FROM "Upload" u WHERE a."uploadId" = u.id AND u."resourceRefId" = ANY($1::uuid[])`,
      [ids],
    );
    const removed = await db.query<{ size: string | null; objectKey: string | null }>(
      `DELETE FROM "Resource" WHERE "deletionId" = $1 AND id = ANY($2::uuid[])
       RETURNING size,"objectKey"`,
      [attempt.id, ids],
    );
    const bytes = removed.rows.reduce(
      (total, row) => total + (row.objectKey ? BigInt(row.size ?? 0) : 0n),
      0n,
    );
    await db.query('UPDATE "User" SET "usedBytes" = "usedBytes" - $2 WHERE id = $1', [
      attempt.ownerId,
      bytes.toString(),
    ]);
    const {
      rows: [job],
    } = await db.query<{ status: string }>(
      `UPDATE "Deletion" SET "processedResources" = "processedResources" + $2,
        status = CASE WHEN "processedResources" + $2 = "affectedResources"
          THEN 'COMPLETED' ELSE status END,
        "attemptId" = CASE WHEN "processedResources" + $2 = "affectedResources" THEN NULL ELSE "attemptId" END,
        "leaseUntil" = CASE WHEN "processedResources" + $2 = "affectedResources" THEN NULL ELSE "leaseUntil" END,
        "updatedAt" = now() WHERE id = $1 RETURNING status`,
      [attempt.id, removed.rowCount],
    );
    return job.status === 'PROCESSING';
  });
}

export async function processDeletion(id: string, renewVisibility?: () => Promise<void>) {
  const attempt = await acquireDeletion(id);
  if (!attempt) return true;
  try {
    while (true) {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT r.id FROM "Resource" r WHERE r."deletionId" = $1
         AND NOT EXISTS (SELECT 1 FROM "Resource" child WHERE child."parentId" = r.id)
         ORDER BY r.id LIMIT 50`,
        [id],
      );
      if (!rows.length) throw new Error('No hay recursos pendientes para procesar');
      const ids = rows.map((row) => row.id);
      await cleanObjects(ids);
      if (!(await finishBatch(attempt, ids))) return true;
      await renewVisibility?.();
    }
  } catch {
    await retryDeletion(attempt);
    return true;
  }
}
