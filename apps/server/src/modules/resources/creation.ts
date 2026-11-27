import type { PoolClient } from 'pg';
import { AuthorizationService } from '../authorization/service.ts';
import { AppError } from '../identity/errors.ts';

export async function lockCreationParent(db: PoolClient, ownerId: string, parentId: string) {
  await db.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [ownerId]);
  const access = await new AuthorizationService(db).evaluate({
    actorId: ownerId,
    resourceId: parentId,
    action: 'CREATE_CHILD',
  });
  if (!access.allowed) {
    throw new AppError(
      access.visible ? 'FORBIDDEN' : 'RESOURCE_UNAVAILABLE',
      'Carpeta no disponible',
      access.visible ? 403 : 404,
    );
  }
  const parent = await db.query(
    `SELECT id FROM "Resource" WHERE id = $1 AND kind = 'FOLDER' AND status = 'ACTIVE' FOR UPDATE`,
    [parentId],
  );
  if (!parent.rowCount) throw new AppError('RESOURCE_UNAVAILABLE', 'Carpeta no disponible', 404);

  const { rows } = await db.query<{ depth: number }>(
    `WITH RECURSIVE ancestors AS (
      SELECT id, "parentId", 1 AS depth FROM "Resource" WHERE id = $1
      UNION ALL
      SELECT r.id, r."parentId", a.depth + 1 FROM "Resource" r
      JOIN ancestors a ON r.id = a."parentId" WHERE a.depth <= 10
    ) SELECT max(depth)::integer AS depth FROM ancestors`,
    [parentId],
  );
  if (rows[0].depth > 10) {
    throw new AppError('DEPTH_EXCEEDED', 'Se alcanzó la profundidad máxima', 409);
  }
}
