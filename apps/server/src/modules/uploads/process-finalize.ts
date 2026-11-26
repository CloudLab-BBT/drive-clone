import { pool } from '../../platform/clients.ts';
import { normalizeName } from './validation.ts';
import { AuthorizationService } from '../authorization/service.ts';
import { AppError } from '../identity/errors.ts';
import type { Job } from './process-acquire.ts';
import { enqueueUpload } from './outbox.ts';
export async function complete(
  job: Job,
  attemptId: string,
  objectKey: string,
  recoverExpired = false,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [job.userId]);
    const target = await client.query<{ parentId: string; status: string }>(
      'SELECT "parentId",status FROM "Resource" WHERE id = $1 FOR UPDATE',
      [job.resourceId],
    );
    if (target.rows[0]?.status !== 'RESERVED') {
      await client.query('ROLLBACK');
      return false;
    }
    const access = await new AuthorizationService(client).evaluate({
      actorId: job.userId,
      resourceId: target.rows[0].parentId,
      action: 'CREATE_CHILD',
    });
    if (!access.allowed) throw new AppError('RESOURCE_UNAVAILABLE', 'Carpeta no disponible', 404);
    const attempt = await client.query(
      `UPDATE "UploadAttempt" SET status = 'PUBLISHED',
      "updatedAt" = now() WHERE id = $1 AND status = 'WRITING' RETURNING id`,
      [attemptId],
    );
    if (!attempt.rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    const result = await client.query(
      `UPDATE "Upload" SET status = 'COMPLETED', "leaseUntil" = NULL,
      "updatedAt" = now() WHERE id = $1 AND "attemptId" = $2 AND status = 'PROCESSING'
      AND (CASE WHEN $3 THEN "leaseUntil" <= now() ELSE "leaseUntil" > now() END) RETURNING id`,
      [job.id, attemptId, recoverExpired],
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    const resource = await client.query(
      `UPDATE "Resource" SET status = 'ACTIVE', size = $2, "mimeType" = $3,
      sha256 = $4, "objectKey" = $5, "updatedAt" = now()
      WHERE id = $1 AND status = 'RESERVED'`,
      [job.resourceId, job.receivedBytes, normalizeName(job.name).mimeType, job.sha256, objectKey],
    );
    if (resource.rowCount !== 1) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `UPDATE "User" SET "reservedBytes" = "reservedBytes" - $2,
      "usedBytes" = "usedBytes" + $2 WHERE id = $1`,
      [job.userId, job.expectedSize],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function fail(
  job: Job,
  attemptId: string,
  cleaned: boolean,
  unavailable = false,
  failureCode = 'PROCESSING_FAILED',
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [job.userId]);
    const terminal = unavailable || job.attemptCount + 1 >= 3;
    const delay = job.attemptCount === 0 ? 5 : 20;
    const residues = await client.query(
      `SELECT id FROM "UploadAttempt"
      WHERE "uploadId" = $1 AND status = 'DISCARDED' LIMIT 1`,
      [job.id],
    );
    const fullyCleaned = cleaned && !residues.rowCount;
    const result = await client.query<{ nextAttemptAt: Date | null }>(
      `UPDATE "Upload" SET status = $3, "attemptId" = NULL,
      "leaseUntil" = NULL, "nextAttemptAt" = CASE WHEN $4 THEN NULL
        ELSE now() + ($6::int * interval '1 second') END,
      "errorCode" = CASE WHEN $4 THEN 'PROCESSING_FAILED' ELSE NULL END,
      "cleanupPending" = NOT $5,
      "updatedAt" = now() WHERE id = $1 AND "attemptId" = $2 AND status = 'PROCESSING'
      RETURNING "nextAttemptAt"`,
      [job.id, attemptId, terminal ? 'FAILED' : 'QUEUED', terminal, fullyCleaned, delay],
    );
    if (!terminal && result.rowCount)
      await enqueueUpload(client, job.id, result.rows[0].nextAttemptAt!);
    if (terminal && fullyCleaned && result.rowCount) {
      await client.query('DELETE FROM "Resource" WHERE id = $1 AND status = $2', [
        job.resourceId,
        'RESERVED',
      ]);
      await client.query(
        `UPDATE "User" SET "reservedBytes" = "reservedBytes" - $2
        WHERE id = $1`,
        [job.userId, job.expectedSize],
      );
    }
    await client.query(
      `UPDATE "UploadAttempt" SET status = 'DISCARDED', "failureCode" = $2,
        "updatedAt" = now() WHERE id = $1 AND status = 'WRITING'`,
      [attemptId, failureCode],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
