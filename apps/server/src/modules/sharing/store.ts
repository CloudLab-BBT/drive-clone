import type { Pool, PoolClient } from 'pg';
import { AuthorizationService, type AccessPage } from '../authorization/service.ts';
import { AppError, InvalidInputError } from '../identity/errors.ts';
import { validateUsername } from '../identity/username.ts';

type Permission = 'READ' | 'EDIT';
interface Grant {
  userId: string;
  username: string;
  permission: Permission;
  createdAt: string;
}

export class ShareStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async authorized<T>(
    actorId: string,
    resourceId: string,
    mutate: boolean,
    operation: (db: PoolClient, access: AuthorizationService) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query(mutate ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (mutate) await db.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [actorId]);
      const access = new AuthorizationService(db);
      const decision = await access.evaluate({ actorId, resourceId, action: 'MANAGE_SHARES' });
      if (!decision.visible)
        throw new AppError('RESOURCE_UNAVAILABLE', 'Recurso no disponible', 404);
      if (!decision.allowed) throw new AppError('FORBIDDEN', 'Acción no permitida', 403);
      const result = await operation(db, access);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async list(actorId: string, resourceId: string, { limit = 25, after }: AccessPage) {
    return this.authorized(actorId, resourceId, false, async (db, access) => {
      const { rows } = await db.query<Grant>(
        `SELECT s."userId",u.username,s.permission,
          to_char(s."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
         FROM "Share" s JOIN "User" u ON u.id = s."userId"
         WHERE s."resourceId" = $1 AND ($2::timestamptz IS NULL OR
           (s."createdAt",s."userId") > ($2::timestamptz,$3::uuid))
         ORDER BY s."createdAt",s."userId" LIMIT $4`,
        [resourceId, after?.createdAt ?? null, after?.id ?? null, limit + 1],
      );
      const items = [];
      for (const grant of rows.slice(0, limit)) {
        items.push({
          ...grant,
          effectivePermission: await this.effective(access, grant.userId, resourceId),
        });
      }
      const last = items.at(-1);
      return {
        items,
        next: rows.length > limit && last ? { id: last.userId, createdAt: last.createdAt } : null,
      };
    });
  }

  async upsert(actorId: string, resourceId: string, username: string, permission: Permission) {
    return this.authorized(actorId, resourceId, true, async (db, access) => {
      const validated = validateUsername(username);
      if (!validated.valid) throw new InvalidInputError(validated.error);
      const {
        rows: [recipient],
      } = await db.query<{ id: string; username: string }>(
        'SELECT id,username FROM "User" WHERE username = $1',
        [validated.normalized],
      );
      if (!recipient) throw new AppError('RESOURCE_UNAVAILABLE', 'Usuario no encontrado', 404);
      if (recipient.id === actorId) throw new InvalidInputError('El propietario ya tiene acceso');
      const {
        rows: [grant],
      } = await db.query<{ createdAt: Date }>(
        `INSERT INTO "Share" ("resourceId","userId",permission,"updatedAt")
         VALUES ($1,$2,$3,now()) ON CONFLICT ("resourceId","userId")
         DO UPDATE SET permission = EXCLUDED.permission,"updatedAt" = now()
         RETURNING "createdAt"`,
        [resourceId, recipient.id, permission],
      );
      return {
        userId: recipient.id,
        username: recipient.username,
        permission,
        createdAt: grant.createdAt.toISOString(),
        effectivePermission: await this.effective(access, recipient.id, resourceId),
      };
    });
  }

  async revoke(actorId: string, resourceId: string, userId: string) {
    return this.authorized(actorId, resourceId, true, async (db, access) => {
      await db.query('DELETE FROM "Share" WHERE "resourceId" = $1 AND "userId" = $2', [
        resourceId,
        userId,
      ]);
      return { userId, remainingPermission: await this.effective(access, userId, resourceId) };
    });
  }

  private async effective(access: AuthorizationService, actorId: string, resourceId: string) {
    const { effectivePermission } = await access.evaluate({ actorId, resourceId, action: 'VIEW' });
    return effectivePermission === 'OWNER' ? null : effectivePermission;
  }
}
