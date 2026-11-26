import { pool } from '../../platform/clients.ts';

export async function pruneRecoveryHistory(): Promise<void> {
  await pool.query(`DELETE FROM "QueueObservation" WHERE id IN (
    SELECT id FROM "QueueObservation" WHERE "observedAt" < now() - interval '30 days'
    ORDER BY "observedAt" LIMIT 1000)`);
  await pool.query(`DELETE FROM "Outbox" WHERE id IN (
    SELECT id FROM "Outbox" WHERE type = 'UPLOAD' AND "publishedAt" IS NOT NULL
      AND "publishedAt" < now() - interval '30 days'
    ORDER BY "publishedAt" LIMIT 1000)`);
}
