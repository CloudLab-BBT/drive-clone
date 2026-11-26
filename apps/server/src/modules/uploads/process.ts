import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { normalizeName } from './validation.ts';
import { AppError } from '../identity/errors.ts';
import { cleanupCancellation } from './cancel.ts';
import { verifyTemp } from './verify.ts';
import { acquire } from './process-acquire.ts';
import { complete, fail } from './process-finalize.ts';
import { discardObject } from './attempts.ts';
export async function renew(id: string, attemptId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE "Upload" SET "leaseUntil" = now() + interval '60 seconds'
    WHERE id = $1 AND "attemptId" = $2 AND status = 'PROCESSING' AND "leaseUntil" > now()`,
    [id, attemptId],
  );
  return result.rowCount === 1;
}
export async function processUpload(
  id: string,
  renewVisibility?: () => Promise<void>,
): Promise<boolean> {
  const acquired = await acquire(id);
  if (!acquired) {
    const state = await pool.query<{ status: string }>(
      'SELECT status FROM "Upload" WHERE id = $1',
      [id],
    );
    return (
      !state.rows[0] ||
      ['COMPLETED', 'FAILED', 'CANCELLED', 'CANCEL_REQUESTED'].includes(state.rows[0].status)
    );
  }
  const { job, attemptId, objectKey } = acquired;
  let leaseLost = false;
  let completed = false;
  const timer = setInterval(() => {
    void renew(id, attemptId)
      .then(async (ok) => {
        if (!ok) {
          leaseLost = true;
          return;
        }
        await renewVisibility?.();
      })
      .catch(() => {
        leaseLost = true;
      });
  }, 20_000);
  try {
    await verifyTemp(join(config.tempDir, job.tempKey!), Number(job.receivedBytes), job.sha256!);
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        IfNoneMatch: '*',
        Body: createReadStream(join(config.tempDir, job.tempKey!)),
        ContentLength: Number(job.receivedBytes),
        ContentType: normalizeName(job.name).mimeType,
      }),
    );
    if (leaseLost || !(await complete(job, attemptId, objectKey))) {
      const published = await discardObject(attemptId, objectKey);
      if (published) return true;
      await pool.query(
        `UPDATE "Upload" SET "leaseUntil" = NULL WHERE id = $1
        AND "attemptId" = $2 AND status = 'CANCEL_REQUESTED'`,
        [id, attemptId],
      );
      await cleanupCancellation(id);
      return false;
    }
    completed = true;
    try {
      await rm(join(config.tempDir, job.tempKey!), { force: true });
    } catch {
      await pool.query('UPDATE "Upload" SET "cleanupPending" = true WHERE id = $1', [job.id]);
    }
    return true;
  } catch (error) {
    if (completed) return true;
    const state = await pool.query<{ status: string }>(
      'SELECT status FROM "Upload" WHERE id = $1',
      [id],
    );
    if (state.rows[0]?.status === 'CANCEL_REQUESTED') {
      try {
        await discardObject(attemptId, objectKey);
        await pool.query(
          `UPDATE "Upload" SET "leaseUntil" = NULL WHERE id = $1
          AND "attemptId" = $2 AND status = 'CANCEL_REQUESTED'`,
          [id, attemptId],
        );
        await cleanupCancellation(id);
      } catch {
        /* La conciliación reintentará la limpieza. */
      }
      return false;
    }
    if (leaseLost) return false;
    let cleaned = true;
    try {
      await discardObject(attemptId, objectKey);
    } catch {
      cleaned = false;
    }
    const missingTemp = (error as { code?: string }).code === 'ENOENT';
    const unavailable =
      missingTemp || (error instanceof AppError && error.code === 'RESOURCE_UNAVAILABLE');
    if ((unavailable || job.attemptCount + 1 >= 3) && cleaned) {
      try {
        await rm(join(config.tempDir, job.tempKey!), { force: true });
      } catch {
        cleaned = false;
      }
    }
    await fail(
      job,
      attemptId,
      cleaned,
      unavailable,
      missingTemp ? 'TEMP_MISSING' : unavailable ? 'DESTINATION_UNAVAILABLE' : 'PROCESSING_FAILED',
    );
    return false;
  } finally {
    clearInterval(timer);
  }
}
