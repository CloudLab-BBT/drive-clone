import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import type { UploadRow } from './store.ts';

export async function cleanupCancellation(
  id: string,
  receiverStopped = false,
  removeTemp: typeof rm = rm,
): Promise<void> {
  if (receiverStopped)
    await pool.query(
      `UPDATE "Upload" SET "leaseUntil" = NULL
    WHERE id = $1 AND status = 'CANCEL_REQUESTED' AND "attemptId" IS NULL`,
      [id],
    );
  const found = await pool.query<UploadRow>('SELECT * FROM "Upload" WHERE id = $1', [id]);
  const row = found.rows[0];
  if (!row || row.status !== 'CANCEL_REQUESTED') return;
  if (row.leaseUntil && row.leaseUntil.getTime() > Date.now()) return;
  const attempts = await pool.query<{ id: string; objectKey: string }>(
    'SELECT id,"objectKey" FROM "UploadAttempt" WHERE "uploadId" = $1',
    [id],
  );
  try {
    for (const attempt of attempts.rows)
      await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: attempt.objectKey }));
    if (row.tempKey) {
      await removeTemp(join(config.tempDir, row.tempKey), { force: true });
      if (row.tempKey.endsWith('.part'))
        await removeTemp(join(config.tempDir, row.tempKey.replace(/\.part$/, '.ready')), {
          force: true,
        });
    }
  } catch {
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [row.userId]);
    const locked = await client.query<UploadRow>(
      'SELECT * FROM "Upload" WHERE id = $1 FOR UPDATE',
      [id],
    );
    const current = locked.rows[0];
    if (
      current?.status !== 'CANCEL_REQUESTED' ||
      (current.leaseUntil && current.leaseUntil.getTime() > Date.now())
    ) {
      await client.query('COMMIT');
      return;
    }
    await client.query('DELETE FROM "Resource" WHERE id = $1 AND status = $2', [
      current.resourceId,
      'RESERVED',
    ]);
    await client.query('UPDATE "User" SET "reservedBytes" = "reservedBytes" - $2 WHERE id = $1', [
      current.userId,
      current.expectedSize,
    ]);
    await client.query(
      `UPDATE "Upload" SET status = 'CANCELLED', "cleanupPending" = false,
      "attemptId" = NULL, "leaseUntil" = NULL, "updatedAt" = now() WHERE id = $1`,
      [id],
    );
    await client.query(
      `UPDATE "UploadAttempt" SET status = 'DISCARDED', "updatedAt" = now()
      WHERE "uploadId" = $1`,
      [id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { requestCancellation } from './cancel-request.ts';
export { cleanupFailed } from './cancel-failed.ts';
