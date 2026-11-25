import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createUpload, failUpload } from './store-transitions.ts';
import { AppError } from '../identity/errors.ts';

export interface UploadRow {
  id: string;
  userId: string;
  resourceId: string;
  status: string;
  expectedSize: string;
  receivedBytes: string;
  tempKey: string | null;
  sha256: string | null;
  attemptId: string | null;
  attemptCount: number;
  leaseUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  cleanupPending: boolean;
  errorCode: string | null;
}

export function publicUpload(row: UploadRow) {
  return {
    id: row.id,
    resourceId: row.resourceId,
    status: row.status,
    size: Number(row.expectedSize),
    receivedBytes: Number(row.receivedBytes),
    attemptCount: row.attemptCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cleanupPending: row.cleanupPending,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
  };
}

export class UploadStore {
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(userId: string, input: { parentId: string; name: string; size: number }) {
    return createUpload(this.pool, userId, input);
  }

  async get(id: string, userId: string) {
    const result = await this.pool.query<UploadRow>(
      'SELECT * FROM "Upload" WHERE id = $1 AND "userId" = $2',
      [id, userId],
    );
    if (!result.rows[0]) throw new AppError('RESOURCE_UNAVAILABLE', 'Carga no disponible', 404);
    return result.rows[0];
  }

  async active(userId: string) {
    const result = await this.pool.query<UploadRow>(
      `SELECT * FROM "Upload" WHERE "userId" = $1
      AND status NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY "createdAt",id LIMIT 10`,
      [userId],
    );
    return result.rows;
  }

  async start(id: string, userId: string) {
    const tempKey = `${randomUUID()}.part`;
    const result = await this.pool.query<UploadRow>(
      `UPDATE "Upload" SET status = 'RECEIVING', "tempKey" = $3, "updatedAt" = now()
      WHERE id = $1 AND "userId" = $2 AND status = 'CREATED'
      AND "createdAt" > now() - interval '15 minutes' RETURNING *`,
      [id, userId, tempKey],
    );
    if (!result.rows[0])
      throw new AppError('STATE_CONFLICT', 'La carga no puede recibir contenido', 409);
    return result.rows[0];
  }

  async queue(id: string, userId: string, tempKey: string, bytes: number, sha256: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<UploadRow>(
        `UPDATE "Upload" SET status = 'QUEUED', "tempKey" = $3,
        "receivedBytes" = $4, sha256 = $5, "updatedAt" = now()
        WHERE id = $1 AND "userId" = $2 AND status = 'RECEIVING' AND "expectedSize" = $4 RETURNING *`,
        [id, userId, tempKey, bytes, sha256],
      );
      if (!result.rows[0])
        throw new AppError('STATE_CONFLICT', 'La recepción no está vigente', 409);
      await client.query(
        `INSERT INTO "Outbox" (id,"entityId",type,version,payload)
        VALUES ($1,$2,'UPLOAD',1,$3)`,
        [randomUUID(), id, JSON.stringify({ version: 1, type: 'UPLOAD', id })],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(id: string, code: string) {
    return failUpload(this.pool, id, code);
  }
}
