import type { Pool, PoolClient } from 'pg';
import { AuthorizationService, type AccessPage } from '../authorization/service.ts';
import { AppError } from '../identity/errors.ts';

export interface FileRow {
  id: string; ownerId: string; parentId: string | null; kind: 'FILE' | 'FOLDER';
  isRoot: boolean; name: string; size: string | null; mimeType: string | null;
  objectKey: string | null; createdAt: Date; updatedAt: Date;
}

async function snapshot<T>(pool: Pool, read: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await read(db);
    await db.query('COMMIT');
    return result;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

async function rows(db: PoolClient, ids: string[]): Promise<Map<string, FileRow>> {
  if (!ids.length) return new Map();
  const result = await db.query<FileRow>(`SELECT id,"ownerId","parentId",kind,"isRoot",name,
    size,"mimeType","objectKey","createdAt","updatedAt" FROM "Resource"
    WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'`, [ids]);
  return new Map(result.rows.map((row) => [row.id, row]));
}

export function publicResource(row: FileRow, permission: 'OWNER' | 'READ' | 'EDIT') {
  const base = { id: row.id, ownerId: row.ownerId, parentId: row.parentId,
    kind: row.kind, isRoot: row.isRoot, name: row.name,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    effectivePermission: permission };
  return row.kind === 'FILE' ? { ...base, size: Number(row.size), mimeType: row.mimeType } : base;
}

export class FileStore {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async children(actorId: string, folderId: string, page: AccessPage) {
    return snapshot(this.pool, async (db) => {
      const access = new AuthorizationService(db);
      const decision = await access.evaluate({ actorId, resourceId: folderId, action: 'LIST_CHILDREN' });
      if (!decision.visible) throw new AppError('RESOURCE_UNAVAILABLE', 'Carpeta no disponible', 404);
      const folder = (await rows(db, [folderId])).get(folderId);
      if (folder?.kind !== 'FOLDER') throw new AppError('STATE_CONFLICT', 'El recurso no es una carpeta', 409);
      const result = await access.listChildren(actorId, folderId, page);
      if (!result) throw new AppError('RESOURCE_UNAVAILABLE', 'Carpeta no disponible', 404);
      const found = await rows(db, result.items.map((item) => item.id));
      return { items: result.items.flatMap((item) => {
        const row = found.get(item.id);
        return row ? [publicResource(row, item.effectivePermission)] : [];
      }), next: result.next };
    });
  }

  async shared(actorId: string, page: AccessPage) {
    return snapshot(this.pool, async (db) => {
      const result = await new AuthorizationService(db).listShared(actorId, page);
      const found = await rows(db, result.items.map((item) => item.id));
      return { items: result.items.flatMap((item) => {
        const row = found.get(item.id);
        if (!row) return [];
        const { parentId: _privateParentId, ...shared } = publicResource(row, item.effectivePermission);
        return [shared];
      }), next: result.next };
    });
  }

  async download(actorId: string, id: string): Promise<FileRow> {
    return snapshot(this.pool, async (db) => {
      const decision = await new AuthorizationService(db).evaluate({ actorId, resourceId: id,
        action: 'DOWNLOAD' });
      if (!decision.visible) throw new AppError('RESOURCE_UNAVAILABLE', 'Archivo no disponible', 404);
      const row = (await rows(db, [id])).get(id);
      if (row?.kind !== 'FILE') throw new AppError('STATE_CONFLICT', 'El recurso no es un archivo', 409);
      if (!row.objectKey || !row.mimeType || row.size === null)
        throw new AppError('DEPENDENCY_UNAVAILABLE', 'Archivo no disponible temporalmente', 503);
      return row;
    });
  }
}
