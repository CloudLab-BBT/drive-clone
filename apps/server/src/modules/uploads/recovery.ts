import { pool } from '../../platform/clients.ts';
import type { Job } from './process-acquire.ts';
import { complete } from './process-finalize.ts';
import { cleanupCompleted, discardObject } from './attempts.ts';
import { verifyObject } from './object-verify.ts';
import { releaseExpired } from './recovery-transition.ts';
import { cleanupFailed } from './cancel.ts';
import { AppError } from '../identity/errors.ts';

export async function recoverExpired(): Promise<void> {
  const rows = await pool.query<Job & { objectKey: string; attemptStatus: string }>(
    `SELECT u.*,r.name,a."objectKey",a.status AS "attemptStatus"
      FROM "Upload" u LEFT JOIN "Resource" r ON r.id = u."resourceId"
      JOIN "UploadAttempt" a ON a.id = u."attemptId"
      WHERE u.status = 'PROCESSING' AND u."leaseUntil" <= now()
      ORDER BY u."leaseUntil" LIMIT 20`,
  );
  for (const row of rows.rows) {
    if (!row.attemptId || !row.sha256) continue;
    if (!row.name) {
      await discardObject(row.attemptId, row.objectKey);
      if (await releaseExpired(row.id, row.attemptId, 'DESTINATION_UNAVAILABLE', true))
        await cleanupFailed(row.id);
      continue;
    }
    const object =
      row.attemptStatus === 'WRITING'
        ? await verifyObject(row.objectKey, Number(row.receivedBytes), row.sha256)
        : 'MISSING';
    if (object === 'VALID') {
      try {
        if (await complete(row, row.attemptId, row.objectKey, true)) {
          await cleanupCompleted(row.id);
        } else {
          const current = await pool.query<{ status: string; attemptId: string | null }>(
            'SELECT status,"attemptId" FROM "Upload" WHERE id = $1',
            [row.id],
          );
          if (
            current.rows[0]?.status === 'PROCESSING' &&
            current.rows[0].attemptId === row.attemptId
          ) {
            await discardObject(row.attemptId, row.objectKey);
            if (await releaseExpired(row.id, row.attemptId, 'PUBLISH_CONFLICT', true))
              await cleanupFailed(row.id);
          }
        }
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'RESOURCE_UNAVAILABLE')) throw error;
        await discardObject(row.attemptId, row.objectKey);
        if (await releaseExpired(row.id, row.attemptId, 'DESTINATION_UNAVAILABLE', true))
          await cleanupFailed(row.id);
      }
      continue;
    }
    if (object === 'CORRUPT') await discardObject(row.attemptId, row.objectKey);
    const released = await releaseExpired(
      row.id,
      row.attemptId,
      object === 'CORRUPT' ? 'OBJECT_MISMATCH' : 'LEASE_EXPIRED',
    );
    if (released) await cleanupFailed(row.id);
  }
}
