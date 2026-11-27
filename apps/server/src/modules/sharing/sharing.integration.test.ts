import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { closeClients, pool } from '../../platform/clients.ts';
import { folderSession } from '../folders/folder-session.fixture.ts';
import { markDeleting } from '../folders/folder-deletion.fixture.ts';
import { AuthorizationService } from '../authorization/service.ts';

describe('O11 concesiones sobre carpetas', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  type Session = Awaited<ReturnType<typeof folderSession>>;
  const url = (id: string) => `/api/v1/resources/${id}/shares`;
  const put = (actor: Session, id: string, username: string, permission = 'READ') =>
    app.inject({
      method: 'PUT',
      url: url(id),
      headers: actor.headers,
      payload: { username, permission },
    });
  const revoke = (actor: Session, id: string, recipient: Session) =>
    app.inject({ method: 'DELETE', url: `${url(id)}/${recipient.id}`, headers: actor.headers });
  const list = (actor: Session, id: string, query = '') =>
    app.inject({ url: url(id) + query, headers: actor.headers });
  async function username(session: Session) {
    const { rows } = await pool.query<{ username: string }>(
      'SELECT username FROM "User" WHERE id = $1',
      [session.id],
    );
    return rows[0].username;
  }

  it('combina concesiones, navega sin ancestros privados y revoca solo la vía directa', async () => {
    const [owner, recipient, other] = await Promise.all([
      folderSession(app),
      folderSession(app),
      folderSession(app),
    ]);
    const name = await username(recipient);
    const privateId = (await owner.create(owner.rootId, 'Privada')).json().resource.id;
    const folder = (await owner.create(privateId, 'Equipo')).json().resource.id;
    expect((await put(owner, folder, name, 'EDIT')).statusCode).toBe(200);
    const child = (await owner.create(folder, 'Nueva')).json().resource.id;
    expect((await put(owner, child, ` ${name.toUpperCase()} `)).json().share).toMatchObject({
      permission: 'READ',
      effectivePermission: 'EDIT',
    });
    expect((await put(owner, child, name)).statusCode).toBe(200);
    expect((await put(owner, child, await username(other))).statusCode).toBe(200);
    const first = (await list(owner, child, '?limit=1')).json();
    const second = (await list(owner, child, `?limit=1&cursor=${first.nextCursor}`)).json();
    expect([...first.items, ...second.items].map((grant) => grant.userId)).toEqual([
      recipient.id,
      other.id,
    ]);
    expect(second.nextCursor).toBeNull();
    expect((await list(recipient, child)).statusCode).toBe(403);
    expect((await put(recipient, child, name, 'EDIT')).statusCode).toBe(403);
    expect((await revoke(recipient, child, other)).statusCode).toBe(403);
    const shared = await app.inject({ url: '/api/v1/shared', headers: recipient.headers });
    expect(shared.json().items.map((item: { id: string }) => item.id)).toEqual([folder, child]);
    expect(shared.body).not.toContain(privateId);
    expect((await recipient.list(privateId)).statusCode).toBe(404);
    expect((await other.list(folder)).statusCode).toBe(404);
    expect((await recipient.list(folder)).json().items[0].effectivePermission).toBe('EDIT');
    expect((await revoke(owner, child, recipient)).json().remainingPermission).toBe('EDIT');
    expect((await revoke(owner, child, recipient)).json().remainingPermission).toBe('EDIT');
    expect((await put(owner, folder, name, 'READ')).statusCode).toBe(200);
    const access = new AuthorizationService(pool);
    for (const action of ['RENAME', 'DELETE'] as const) {
      expect(
        (await access.evaluate({ actorId: recipient.id, resourceId: child, action })).allowed,
      ).toBe(false);
    }
    expect((await revoke(owner, folder, recipient)).json().remainingPermission).toBeNull();
    expect((await recipient.list(folder)).statusCode).toBe(404);
  });

  it('rechaza raíz, auto-concesión, username inválido o desconocido y mutaciones sin CSRF', async () => {
    const owner = await folderSession(app);
    const folder = (await owner.create(owner.rootId, 'Privada')).json().resource.id;
    const name = await username(owner);
    expect((await put(owner, owner.rootId, name)).statusCode).toBe(403);
    expect((await put(owner, folder, name)).statusCode).toBe(400);
    expect((await put(owner, folder, 'in/válido')).statusCode).toBe(400);
    expect((await put(owner, folder, 'usuario_inexistente')).statusCode).toBe(404);
    const response = await app.inject({
      method: 'PUT',
      url: url(folder),
      headers: { cookie: owner.headers.cookie, origin: owner.headers.origin },
      payload: { username: name, permission: 'READ' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('después del bloqueo del dueño rechaza una concesión sobre un hijo de un ancestro en eliminación', async () => {
    const owner = await folderSession(app);
    const recipient = await folderSession(app);
    const name = await username(recipient);
    const ancestor = (await owner.create(owner.rootId, 'Ancestro')).json().resource.id;
    const folder = (await owner.create(ancestor, 'Carpeta')).json().resource.id;
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [owner.id]);
      await markDeleting(db, owner.id, ancestor);
      const pending = put(owner, folder, name).then((response) => response);
      try {
        const {
          rows: [backend],
        } = await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        await expect
          .poll(
            async () =>
              (
                await db.query(
                  'SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
                  [backend.pid],
                )
              ).rowCount,
          )
          .toBeGreaterThan(0);
      } finally {
        await db.query('COMMIT');
        expect((await pending).statusCode).toBe(404);
      }
      expect((await recipient.list(folder)).statusCode).toBe(404);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });
});
