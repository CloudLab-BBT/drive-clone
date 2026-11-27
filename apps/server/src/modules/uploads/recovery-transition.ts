import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import type { UploadRow } from './store.ts';
import { enqueueUpload } from './outbox.ts';

export async function releaseExpired(
  id: string,
  attemptId: string,
  reason: string,
  terminal = false,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owner = await client.query<{ userId: string }>(
      'SELECT "userId" FROM "Upload" WHERE id = $1',
      [id],
    );
    if (!owner.rows[0]) {
      await client.query('COMMIT');
      return false;
    }
    await client.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [owner.rows[0].userId]);
    const found = await client.query<UploadRow>(
      `SELECT * FROM "Upload" WHERE id = $1 AND status = 'PROCESSING'
        AND "attemptId" = $2 AND "leaseUntil" <= now() FOR UPDATE`,
      [id, attemptId],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return false;
    }
    const missingTemp = !row.tempKey || !existsSync(join(config.tempDir, row.tempKey));
    const failed = terminal || missingTemp || row.attemptCount >= 3;
    const delay = row.attemptCount === 1 ? 5 : 20;
    const result = await client.query<{ nextAttemptAt: Date | null }>(
      `UPDATE "Upload" SET status = $2, "attemptId" = NULL, "leaseUntil" = NULL,
        "nextAttemptAt" = CASE WHEN $3 THEN NULL ELSE now() + ($4::int * interval '1 second') END,
        "errorCode" = CASE WHEN $3 THEN 'PROCESSING_FAILED' ELSE NULL END,
        "cleanupPending" = CASE WHEN $3 THEN true ELSE "cleanupPending" END,
        "updatedAt" = now() WHERE id = $1 RETURNING "nextAttemptAt"`,
      [id, failed ? 'FAILED' : 'QUEUED', failed, delay],
    );
    await client.query(
      `UPDATE "UploadAttempt" SET status = CASE
      WHEN status = 'WRITING' THEN 'DISCARDED' ELSE status END,
      "failureCode" = $2, "updatedAt" = now()
      WHERE id = $1`,
      [attemptId, missingTemp ? 'TEMP_MISSING' : reason],
    );
    if (!failed) await enqueueUpload(client, id, result.rows[0].nextAttemptAt!);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
