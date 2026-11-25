import { randomUUID } from 'node:crypto';
import { pool } from '../../platform/clients.ts';
import type { UploadRow } from './store.ts';
export interface Job extends UploadRow {
  name: string;
}

export async function acquire(
  id: string,
): Promise<{ job: Job; attemptId: string; objectKey: string } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<Job>(
      `SELECT u.*,r.name FROM "Upload" u JOIN "Resource" r ON r.id = u."resourceId"
      WHERE u.id = $1 AND u.status = 'QUEUED' AND (u."nextAttemptAt" IS NULL OR u."nextAttemptAt" <= now())
      FOR UPDATE OF u`,
      [id],
    );
    const job = found.rows[0];
    if (!job || !job.tempKey || job.attemptCount >= 3) {
      await client.query('COMMIT');
      return null;
    }
    const attemptId = randomUUID();
    const objectKey = `uploads/${job.userId}/${job.id}/${attemptId}`;
    await client.query(
      `UPDATE "Upload" SET status = 'PROCESSING', "attemptId" = $2,
      "attemptCount" = "attemptCount" + 1, "leaseUntil" = now() + interval '60 seconds',
      "updatedAt" = now() WHERE id = $1`,
      [id, attemptId],
    );
    await client.query(
      `INSERT INTO "UploadAttempt" (id,"uploadId","objectKey",status,"updatedAt")
      VALUES ($1,$2,$3,'WRITING',now())`,
      [attemptId, id, objectKey],
    );
    await client.query('COMMIT');
    return { job, attemptId, objectKey };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
