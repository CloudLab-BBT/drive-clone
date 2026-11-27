import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AppError } from '../identity/errors.ts';
import { lockCreationParent } from '../resources/creation.ts';

interface FolderRow {
  id: string;
  ownerId: string;
  parentId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export class FolderStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(ownerId: string, parentId: string, name: string, nameKey: string) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await lockCreationParent(db, ownerId, parentId);
      const { rows } = await db.query<FolderRow>(
        `INSERT INTO "Resource" (id,"ownerId","parentId",kind,name,"nameKey",status,"updatedAt")
        VALUES ($1,$2,$3,'FOLDER',$4,$5,'ACTIVE',now())
        RETURNING id,"ownerId","parentId",name,"createdAt","updatedAt"`,
        [randomUUID(), ownerId, parentId, name, nameKey],
      );
      await db.query('COMMIT');
      return rows[0];
    } catch (error) {
      await db.query('ROLLBACK');
      if (
        (error as { code?: string; constraint?: string }).constraint ===
        'Resource_parentId_nameKey_key'
      ) {
        throw new AppError('NAME_CONFLICT', 'Nombre ya utilizado', 409);
      }
      throw error;
    } finally {
      db.release();
    }
  }
}
