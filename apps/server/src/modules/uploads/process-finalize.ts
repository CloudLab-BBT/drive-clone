import { pool } from '../../platform/clients.ts';
import { normalizeName } from './validation.ts';
import { AuthorizationService } from '../authorization/service.ts';
import { AppError } from '../identity/errors.ts';
import type { Job } from './process-acquire.ts';
export async function complete(job: Job, attemptId: string, objectKey: string): Promise<boolean> {
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
    const result = await client.query(
      `UPDATE "Upload" SET status = 'COMPLETED', "leaseUntil" = NULL,
      "updatedAt" = now() WHERE id = $1 AND "attemptId" = $2 AND status = 'PROCESSING'
      AND "leaseUntil" > now() RETURNING id`,
      [job.id, attemptId],
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
    await client.query(
      `UPDATE "UploadAttempt" SET status = 'PUBLISHED', "updatedAt" = now() WHERE id = $1`,
      [attemptId],
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
export async function fail(job: Job, attemptId: string, cleaned: boolean, unavailable = false) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [job.userId]);
    const terminal = unavailable || job.attemptCount + 1 >= 3;
    const result = await client.query(
      `UPDATE "Upload" SET status = $3, "attemptId" = NULL,
      "leaseUntil" = NULL, "nextAttemptAt" = CASE WHEN $4 THEN NULL ELSE now() + interval '30 seconds' END,
      "errorCode" = CASE WHEN $4 THEN 'PROCESSING_FAILED' ELSE NULL END,
      "cleanupPending" = NOT $5,
      "updatedAt" = now() WHERE id = $1 AND "attemptId" = $2 AND status = 'PROCESSING'
      RETURNING id`,
      [job.id, attemptId, terminal ? 'FAILED' : 'QUEUED', terminal, cleaned],
    );
    if (terminal && cleaned && result.rowCount) {
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
      `UPDATE "UploadAttempt" SET status = 'DISCARDED', "updatedAt" = now() WHERE id = $1`,
      [attemptId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
