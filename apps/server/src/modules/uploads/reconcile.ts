import { pool } from '../../platform/clients.ts';
import { UploadStore } from './store.ts';
import { cleanupCancellation, cleanupFailed } from './cancel.ts';
import { cleanupCompleted, cleanupDiscarded } from './attempts.ts';
import { reconcileQueued } from './outbox.ts';
import { recoverExpired } from './recovery.ts';
import { pruneRecoveryHistory } from './history.ts';

export async function reconcileExpired(): Promise<void> {
  await recoverExpired();
  await reconcileQueued();
  await cleanupDiscarded();
  await cleanupCompleted();
  const expired = await pool.query<{ id: string; status: string }>(`SELECT id,status FROM "Upload"
    WHERE (status = 'CREATED' AND "createdAt" < now() - interval '15 minutes')
    OR (status = 'RECEIVING' AND "updatedAt" < now() - interval '10 minutes') LIMIT 20`);
  const store = new UploadStore(pool);
  for (const row of expired.rows)
    await store.fail(row.id, row.status === 'CREATED' ? 'EXPIRED' : 'RECEIVE_INTERRUPTED');
  const cancelled = await pool.query<{ id: string }>(`SELECT id FROM "Upload"
    WHERE status = 'CANCEL_REQUESTED' AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
    ORDER BY "cancelRequestedAt" LIMIT 20`);
  for (const row of cancelled.rows) await cleanupCancellation(row.id);
  const failed = await pool.query<{ id: string }>(`SELECT id FROM "Upload"
    WHERE status = 'FAILED' AND "cleanupPending" = true ORDER BY "updatedAt" LIMIT 20`);
  for (const row of failed.rows) await cleanupFailed(row.id);
  await pruneRecoveryHistory();
}
