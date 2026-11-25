import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import type { UploadRow } from './store.ts';
export async function cleanupFailed(id: string): Promise<void> {
  const found = await pool.query<UploadRow>(
    `SELECT * FROM "Upload"
    WHERE id = $1 AND status = 'FAILED' AND "cleanupPending" = true`,
    [id],
  );
  const row = found.rows[0];
  if (!row) return;
  const attempts = await pool.query<{ objectKey: string }>(
    'SELECT "objectKey" FROM "UploadAttempt" WHERE "uploadId" = $1',
    [id],
  );
  try {
    for (const attempt of attempts.rows)
      await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: attempt.objectKey }));
    if (row.tempKey) {
      await rm(join(config.tempDir, row.tempKey), { force: true });
      if (row.tempKey.endsWith('.part'))
        await rm(join(config.tempDir, row.tempKey.replace(/\.part$/, '.ready')), { force: true });
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
    if (locked.rows[0]?.status === 'FAILED' && locked.rows[0].cleanupPending) {
      await client.query('DELETE FROM "Resource" WHERE id = $1 AND status = $2', [
        row.resourceId,
        'RESERVED',
      ]);
      await client.query('UPDATE "User" SET "reservedBytes" = "reservedBytes" - $2 WHERE id = $1', [
        row.userId,
        row.expectedSize,
      ]);
      await client.query(
        'UPDATE "Upload" SET "cleanupPending" = false, "updatedAt" = now() WHERE id = $1',
        [id],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
