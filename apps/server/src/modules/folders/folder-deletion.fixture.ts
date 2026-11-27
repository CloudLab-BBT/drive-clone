import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export async function markDeleting(db: PoolClient, ownerId: string, resourceId: string) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO "Deletion" (id,"resourceId","ownerId","requestedById",status,
      "affectedResources","updatedAt") VALUES ($1,$2,$3,$3,'PENDING',1,now())`,
    [id, resourceId, ownerId],
  );
  await db.query(`UPDATE "Resource" SET status = 'DELETING', "deletionId" = $2 WHERE id = $1`, [
    resourceId,
    id,
  ]);
}
