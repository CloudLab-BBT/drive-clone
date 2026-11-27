import type { PoolClient } from 'pg';
import { pool } from '../../platform/clients.ts';
import { AuthorizationService } from '../authorization/service.ts';
import { AppError } from '../identity/errors.ts';

export async function transaction<T>(execute: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await execute(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export function unavailable() {
  return new AppError('RESOURCE_UNAVAILABLE', 'Recurso no disponible', 404);
}

export async function lockOwner(db: PoolClient, ownerId: string) {
  await db.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [ownerId]);
}

export async function editAccess(
  db: PoolClient,
  actorId: string,
  id: string,
  action: 'RENAME' | 'DELETE',
) {
  const decision = await new AuthorizationService(db).evaluate({ actorId, resourceId: id, action });
  if (!decision.visible) throw unavailable();
  if (!decision.allowed || !decision.effectivePermission)
    throw new AppError('FORBIDDEN', 'Acción no permitida', 403);
  return decision.effectivePermission;
}
