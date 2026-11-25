import { pool } from '../../platform/clients.ts';
import { AppError } from '../identity/errors.ts';
import type { UploadRow } from './store.ts';
export async function requestCancellation(id: string, userId: string): Promise<UploadRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [userId]);
    const found = await client.query<UploadRow>(
      'SELECT * FROM "Upload" WHERE id = $1 AND "userId" = $2 FOR UPDATE',
      [id, userId],
    );
    const row = found.rows[0];
    if (!row) throw new AppError('RESOURCE_UNAVAILABLE', 'Carga no disponible', 404);
    if (row.status === 'COMPLETED')
      throw new AppError('STATE_CONFLICT', 'La carga ya terminó', 409);
    if (row.status === 'FAILED') {
      await client.query('COMMIT');
      return row;
    }
    const result =
      row.status === 'CANCEL_REQUESTED' || row.status === 'CANCELLED'
        ? row
        : (
            await client.query<UploadRow>(
              `UPDATE "Upload" SET status = 'CANCEL_REQUESTED',
        "cancelRequestedAt" = now(), "cleanupPending" = true,
        "leaseUntil" = CASE WHEN status = 'RECEIVING' THEN now() + interval '10 minutes'
          ELSE "leaseUntil" END, "updatedAt" = now()
        WHERE id = $1 RETURNING *`,
              [id],
            )
          ).rows[0];
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
