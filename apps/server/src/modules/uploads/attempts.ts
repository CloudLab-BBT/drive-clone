import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';

export async function discardObject(id: string, key: string): Promise<boolean> {
  const claimed = await pool.query(
    `UPDATE "UploadAttempt" SET status = 'DISCARDED',
    "updatedAt" = now() WHERE id = $1 AND status = 'WRITING' RETURNING id`,
    [id],
  );
  if (!claimed.rowCount) {
    const current = await pool.query<{ status: string }>(
      'SELECT status FROM "UploadAttempt" WHERE id = $1',
      [id],
    );
    if (current.rows[0]?.status === 'PUBLISHED') return true;
    if (!['DISCARDED', 'CLEANED'].includes(current.rows[0]?.status ?? '')) return false;
  }
  await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  await pool.query(
    `UPDATE "UploadAttempt" SET status = 'CLEANED', "updatedAt" = now()
    WHERE id = $1 AND status = 'DISCARDED'`,
    [id],
  );
  return false;
}

export async function cleanupDiscarded(): Promise<void> {
  const rows = await pool.query<{ id: string; objectKey: string }>(
    `SELECT a.id,a."objectKey" FROM "UploadAttempt" a JOIN "Upload" u ON u.id = a."uploadId"
     WHERE a.status = 'DISCARDED' AND NOT (u.status = 'PROCESSING' AND u."attemptId" = a.id)
     ORDER BY a."updatedAt" LIMIT 20`,
  );
  for (const row of rows.rows) {
    try {
      await discardObject(row.id, row.objectKey);
    } catch {
      /* El inventario persistente conserva el residuo para otro ciclo. */
    }
  }
}

export async function cleanupCompleted(): Promise<void> {
  const rows = await pool.query<{ id: string; tempKey: string | null }>(
    `SELECT id,"tempKey" FROM "Upload" WHERE status = 'COMPLETED'
      AND "cleanupPending" = true ORDER BY "updatedAt" LIMIT 20`,
  );
  for (const row of rows.rows) {
    try {
      if (row.tempKey) await rm(join(config.tempDir, row.tempKey), { force: true });
      const pending = await pool.query(
        `SELECT id FROM "UploadAttempt"
        WHERE "uploadId" = $1 AND status = 'DISCARDED' LIMIT 1`,
        [row.id],
      );
      if (!pending.rowCount)
        await pool.query(
          `UPDATE "Upload" SET "cleanupPending" = false,
        "updatedAt" = now() WHERE id = $1 AND status = 'COMPLETED'`,
          [row.id],
        );
    } catch {
      /* Se reintentará sin tocar el objeto publicado. */
    }
  }
}
