import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import type { Session } from 'fastify';

export interface StoredSession {
  id: string;
  userId: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

/**
 * Store de sesiones compatible con @fastify/session v11 que persiste en PostgreSQL.
 * Implementa get, set, compareAndSet y destroy con callbacks.
 */
export class PgSessionStore extends EventEmitter {
  private pool: Pool;

  constructor(pool: Pool) {
    super();
    this.pool = pool;
  }

  get(sid: string, callback: (err: Error | null, result?: Session | null) => void): void {
    this.pool.query(
      'SELECT id, "userId", data, "createdAt", "lastSeenAt", "expiresAt" FROM "Session" WHERE id = $1 AND "expiresAt" > NOW()',
      [sid],
    ).then((result) => {
      if (result.rows.length === 0) {
        callback(null, null);
        return;
      }
      const row = result.rows[0];
      callback(null, row.data as Session);
    }).catch((err) => {
      callback(err as Error);
    });
  }

  set(sid: string, session: Session, callback: (err?: Error | null) => void): void {
    const userId = ((session as any).userId as string) ?? ((session as any).user?.id as string) ?? null;
    const expiresAt = this.extractExpiresAt(session);
    const data = JSON.stringify(session);

    this.pool.query(
      `INSERT INTO "Session" (id, "userId", data, "createdAt", "lastSeenAt", "expiresAt")
       VALUES ($1, $2, $3, NOW(), NOW(), $4)
       ON CONFLICT (id) DO UPDATE SET
         "userId" = EXCLUDED."userId",
         data = EXCLUDED.data,
         "lastSeenAt" = NOW(),
         "expiresAt" = EXCLUDED."expiresAt"`,
      [sid, userId, data, expiresAt],
    ).then(() => {
      callback(null);
    }).catch((err) => {
      callback(err as Error);
    });
  }

  compareAndSet(
    sid: string,
    expectedGeneration: string,
    session: Session,
    callback: (err?: Error | null) => void,
  ): void {
    this.pool.query(
      'SELECT data FROM "Session" WHERE id = $1 AND "expiresAt" > NOW()',
      [sid],
    ).then((result) => {
      if (result.rows.length === 0) {
        const error = new Error('The session does not exist or has changed');
        (error as any).code = 'ENOENT';
        callback(error);
        return;
      }

      const storedData = result.rows[0].data as Record<string, any>;
      const storedGeneration = storedData?.__fastifySessionMetadata?.generation ?? sid;

      if (expectedGeneration && storedGeneration !== expectedGeneration) {
        const error = new Error('The session does not exist or has changed');
        (error as any).code = 'ENOENT';
        callback(error);
        return;
      }

      const userId = ((session as any).userId as string) ?? ((session as any).user?.id as string) ?? null;
      const expiresAt = this.extractExpiresAt(session);
      const data = JSON.stringify(session);

      return this.pool.query(
        `UPDATE "Session"
         SET "userId" = $2, data = $3, "lastSeenAt" = NOW(), "expiresAt" = $4
         WHERE id = $1`,
        [sid, userId, data, expiresAt],
      ).then(() => {
        callback(null);
      });
    }).catch((err) => {
      callback(err as Error);
    });
  }

  destroy(sid: string, callback: (err?: Error | null) => void): void {
    this.pool.query('DELETE FROM "Session" WHERE id = $1', [sid])
      .then(() => {
        callback(null);
      })
      .catch((err) => {
        callback(err as Error);
      });
  }

  /**
   * Limpiar sesiones expiradas.
   */
  async cleanExpired(): Promise<number> {
    const result = await this.pool.query('DELETE FROM "Session" WHERE "expiresAt" <= NOW()');
    return result.rowCount ?? 0;
  }

  private extractExpiresAt(session: Record<string, any>): Date {
    const defaultMaxAge = 30 * 60 * 1000; // 30 min por inactividad
    if (session?.cookie?.expires) {
      const d = new Date(session.cookie.expires);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (typeof session?.cookie?.maxAge === 'number') {
      return new Date(Date.now() + session.cookie.maxAge);
    }
    return new Date(Date.now() + defaultMaxAge);
  }
}
