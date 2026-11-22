import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AppError } from '../identity/errors.ts';
import { normalizeName, validateSize } from './validation.ts';

export interface UploadRow {
  id: string; userId: string; resourceId: string; status: string;
  expectedSize: string; receivedBytes: string; tempKey: string | null;
  sha256: string | null; attemptId: string | null; attemptCount: number;
  leaseUntil: Date | null; createdAt: Date; updatedAt: Date;
  cleanupPending: boolean; errorCode: string | null;
}

export function publicUpload(row: UploadRow) {
  return { id: row.id, resourceId: row.resourceId, status: row.status,
    size: Number(row.expectedSize), receivedBytes: Number(row.receivedBytes),
    attemptCount: row.attemptCount, createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(), cleanupPending: row.cleanupPending,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}) };
}

export class UploadStore {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async create(userId: string, input: { parentId: string; name: string; size: number }) {
    const { name, nameKey } = normalizeName(input.name);
    const size = validateSize(input.size);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [userId]);
      const parent = await client.query('SELECT id FROM "Resource" WHERE id = $1 AND "ownerId" = $2 AND kind = $3 AND status = $4 FOR UPDATE',
        [input.parentId, userId, 'FOLDER', 'ACTIVE']);
      if (!parent.rowCount) throw new AppError('RESOURCE_UNAVAILABLE', 'Carpeta no disponible', 404);
      const quota = await client.query<{ reservedBytes: string; usedBytes: string }>('SELECT "reservedBytes", "usedBytes" FROM "User" WHERE id = $1', [userId]);
      if (BigInt(quota.rows[0].reservedBytes) + BigInt(quota.rows[0].usedBytes) + BigInt(size) > 1024n ** 3n)
        throw new AppError('QUOTA_EXCEEDED', 'Cuota excedida', 409);
      const active = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "Upload"
        WHERE "userId" = $1 AND status NOT IN ('COMPLETED','FAILED','CANCELLED')`, [userId]);
      if (Number(active.rows[0].count) >= 10) throw new AppError('TOO_MANY_UPLOADS', 'Demasiadas cargas activas', 429);
      const resourceId = randomUUID();
      const id = randomUUID();
      await client.query(`INSERT INTO "Resource" (id,"ownerId","parentId",kind,name,"nameKey",status,"updatedAt")
        VALUES ($1,$2,$3,'FILE',$4,$5,'RESERVED',now())`, [resourceId, userId, input.parentId, name, nameKey]);
      const result = await client.query<UploadRow>(`INSERT INTO "Upload"
        (id,"userId","resourceId","resourceRefId",status,"expectedSize","updatedAt")
        VALUES ($1,$2,$3,$3,'CREATED',$4,now()) RETURNING *`, [id, userId, resourceId, size]);
      await client.query('UPDATE "User" SET "reservedBytes" = "reservedBytes" + $2 WHERE id = $1', [userId, size]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') throw new AppError('NAME_CONFLICT', 'Nombre ya utilizado', 409);
      throw error;
    } finally { client.release(); }
  }

  async get(id: string, userId: string) {
    const result = await this.pool.query<UploadRow>('SELECT * FROM "Upload" WHERE id = $1 AND "userId" = $2', [id, userId]);
    if (!result.rows[0]) throw new AppError('RESOURCE_UNAVAILABLE', 'Carga no disponible', 404);
    return result.rows[0];
  }

  async active(userId: string) {
    const result = await this.pool.query<UploadRow>(`SELECT * FROM "Upload" WHERE "userId" = $1
      AND status NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY "createdAt",id LIMIT 10`, [userId]);
    return result.rows;
  }

  async start(id: string, userId: string) {
    const result = await this.pool.query<UploadRow>(`UPDATE "Upload" SET status = 'RECEIVING', "updatedAt" = now()
      WHERE id = $1 AND "userId" = $2 AND status = 'CREATED'
      AND "createdAt" > now() - interval '15 minutes' RETURNING *`, [id, userId]);
    if (!result.rows[0]) throw new AppError('UPLOAD_CONFLICT', 'La carga no puede recibir contenido', 409);
    return result.rows[0];
  }

  async queue(id: string, userId: string, tempKey: string, bytes: number, sha256: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<UploadRow>(`UPDATE "Upload" SET status = 'QUEUED', "tempKey" = $3,
        "receivedBytes" = $4, sha256 = $5, "updatedAt" = now()
        WHERE id = $1 AND "userId" = $2 AND status = 'RECEIVING' AND "expectedSize" = $4 RETURNING *`,
      [id, userId, tempKey, bytes, sha256]);
      if (!result.rows[0]) throw new AppError('UPLOAD_CONFLICT', 'La recepción no está vigente', 409);
      await client.query(`INSERT INTO "Outbox" (id,"entityId",type,version,payload)
        VALUES ($1,$2,'UPLOAD',1,$3)`, [randomUUID(), id, JSON.stringify({ version: 1, type: 'UPLOAD', id })]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async fail(id: string, code: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const failed = await client.query<{ userId: string; expectedSize: string; resourceId: string }>(
        `UPDATE "Upload" SET status = 'FAILED', "errorCode" = $2, "updatedAt" = now()
        WHERE id = $1 AND status IN ('RECEIVING','CREATED') RETURNING "userId","expectedSize","resourceId"`, [id, code]);
      if (failed.rows[0]) {
        const row = failed.rows[0];
        await client.query('DELETE FROM "Resource" WHERE id = $1 AND status = $2', [row.resourceId, 'RESERVED']);
        await client.query('UPDATE "User" SET "reservedBytes" = "reservedBytes" - $2 WHERE id = $1',
          [row.userId, row.expectedSize]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
