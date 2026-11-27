import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AppError } from '../identity/errors.ts';
import { normalizeName, validateSize } from './validation.ts';
import { lockCreationParent } from '../resources/creation.ts';
import type { UploadRow } from './store.ts';
export async function createUpload(
  pool: Pool,
  userId: string,
  input: { parentId: string; name: string; size: number },
) {
  const { name, nameKey } = normalizeName(input.name);
  const size = validateSize(input.size);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockCreationParent(client, userId, input.parentId);
    const quota = await client.query<{ reservedBytes: string; usedBytes: string }>(
      'SELECT "reservedBytes", "usedBytes" FROM "User" WHERE id = $1',
      [userId],
    );
    if (
      BigInt(quota.rows[0].reservedBytes) + BigInt(quota.rows[0].usedBytes) + BigInt(size) >
      1024n ** 3n
    )
      throw new AppError('QUOTA_EXCEEDED', 'Cuota excedida', 409);
    const active = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Upload"
        WHERE "userId" = $1 AND status NOT IN ('COMPLETED','FAILED','CANCELLED')`,
      [userId],
    );
    if (Number(active.rows[0].count) >= 10)
      throw new AppError('RATE_LIMITED', 'Demasiadas cargas activas', 429);
    const resourceId = randomUUID();
    const id = randomUUID();
    await client.query(
      `INSERT INTO "Resource" (id,"ownerId","parentId",kind,name,"nameKey",status,"updatedAt")
        VALUES ($1,$2,$3,'FILE',$4,$5,'RESERVED',now())`,
      [resourceId, userId, input.parentId, name, nameKey],
    );
    const result = await client.query<UploadRow>(
      `INSERT INTO "Upload"
        (id,"userId","resourceId","resourceRefId",status,"expectedSize","updatedAt")
        VALUES ($1,$2,$3,$3,'CREATED',$4,now()) RETURNING *`,
      [id, userId, resourceId, size],
    );
    await client.query('UPDATE "User" SET "reservedBytes" = "reservedBytes" + $2 WHERE id = $1', [
      userId,
      size,
    ]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505')
      throw new AppError('NAME_CONFLICT', 'Nombre ya utilizado', 409);
    throw error;
  } finally {
    client.release();
  }
}

export async function failUpload(pool: Pool, id: string, code: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owner = await client.query<{ userId: string }>(
      'SELECT "userId" FROM "Upload" WHERE id = $1',
      [id],
    );
    if (owner.rows[0])
      await client.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [owner.rows[0].userId]);
    const failed = await client.query<{
      userId: string;
      expectedSize: string;
      resourceId: string;
      tempKey: string | null;
    }>(
      `UPDATE "Upload" SET status = 'FAILED', "errorCode" = $2, "cleanupPending" = true, "updatedAt" = now()
        WHERE id = $1 AND status IN ('RECEIVING','CREATED') RETURNING "userId","expectedSize","resourceId","tempKey"`,
      [id, code],
    );
    if (failed.rows[0]) {
      const row = failed.rows[0];
      if (!row.tempKey) {
        await client.query('DELETE FROM "Resource" WHERE id = $1 AND status = $2', [
          row.resourceId,
          'RESERVED',
        ]);
        await client.query(
          'UPDATE "User" SET "reservedBytes" = "reservedBytes" - $2 WHERE id = $1',
          [row.userId, row.expectedSize],
        );
        await client.query('UPDATE "Upload" SET "cleanupPending" = false WHERE id = $1', [id]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
