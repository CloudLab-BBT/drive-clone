import { randomUUID } from 'node:crypto';
import { pool } from '../../platform/clients.ts';
import { editAccess, lockOwner, transaction, unavailable } from '../editing/transaction.ts';
import { AppError } from '../identity/errors.ts';
import { enqueueWork } from '../uploads/outbox.ts';
import { type DeletionRow, publicDeletion } from './model.ts';

export async function getDeletion(actorId: string, id: string) {
  const {
    rows: [row],
  } = await pool.query<DeletionRow>(
    'SELECT * FROM "Deletion" WHERE id = $1 AND $2 IN ("ownerId","requestedById")',
    [id, actorId],
  );
  if (!row) throw unavailable();
  return publicDeletion(row);
}

export async function requestDeletion(actorId: string, rootId: string) {
  return transaction(async (db) => {
    const initial = await db.query<{ ownerId: string }>(
      'SELECT "ownerId" FROM "Resource" WHERE id = $1',
      [rootId],
    );
    const ownerId = initial.rows[0]?.ownerId;
    if (!ownerId) throw unavailable();
    await lockOwner(db, ownerId);

    const {
      rows: [existing],
    } = await db.query<DeletionRow>(
      `SELECT d.* FROM "Resource" r JOIN "Deletion" d ON d.id = r."deletionId"
       WHERE r.id = $1 AND d."resourceId" = $1 AND $2 IN (d."ownerId",d."requestedById")`,
      [rootId, actorId],
    );
    if (existing) return publicDeletion(existing);
    await editAccess(db, actorId, rootId, 'DELETE');
    const {
      rows: [impact],
    } = await db.query<{ count: number; overlapping: boolean }>(
      `WITH RECURSIVE tree AS (
        SELECT id,status FROM "Resource" WHERE id = $1
        UNION ALL SELECT r.id,r.status FROM "Resource" r JOIN tree p ON r."parentId" = p.id
      ) SELECT count(*)::integer AS count,
        coalesce(bool_or(status = 'DELETING'),false) AS overlapping FROM tree`,
      [rootId],
    );
    if (impact.overlapping)
      throw new AppError('STATE_CONFLICT', 'Ya hay una eliminación dentro de esta carpeta', 409);

    const id = randomUUID();
    const {
      rows: [job],
    } = await db.query<DeletionRow>(
      `INSERT INTO "Deletion" (id,"resourceId","ownerId","requestedById",status,"affectedResources","updatedAt")
       VALUES ($1,$2,$3,$4,'PENDING',$5,now()) RETURNING *`,
      [id, rootId, ownerId, actorId, impact.count],
    );
    await db.query(
      `WITH RECURSIVE tree AS (
        SELECT id FROM "Resource" WHERE id = $1
        UNION ALL SELECT r.id FROM "Resource" r JOIN tree p ON r."parentId" = p.id
      ) UPDATE "Resource" SET status = 'DELETING', "deletionId" = $2, "updatedAt" = now()
        WHERE id IN (SELECT id FROM tree)`,
      [rootId, id],
    );
    await db.query(
      `DELETE FROM "Share" s USING "Resource" r WHERE s."resourceId" = r.id AND r."deletionId" = $1`,
      [id],
    );
    await db.query(
      `UPDATE "Upload" u SET status = 'CANCEL_REQUESTED',"cancelRequestedAt" = now(),
        "cleanupPending" = true, "leaseUntil" = CASE WHEN u.status = 'RECEIVING'
          THEN clock_timestamp() + interval '10 minutes' ELSE u."leaseUntil" END,"updatedAt" = now()
       FROM "Resource" r WHERE u."resourceRefId" = r.id AND r."deletionId" = $1
         AND u.status IN ('CREATED','RECEIVING','QUEUED','PROCESSING')`,
      [id],
    );
    await enqueueWork(db, 'DELETE', id);
    return publicDeletion(job);
  });
}
