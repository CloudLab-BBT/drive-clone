import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { closeClients, pool } from '../../platform/clients.ts';
import { markDeleting } from './folder-deletion.fixture.ts';
import { folderSession } from './folder-session.fixture.ts';

describe('O08 creación y listado de carpetas', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  it('persiste diez niveles, devuelve el dueño y rechaza el siguiente nivel', async () => {
    const owner = await folderSession(app);
    let parentId = owner.rootId;
    for (let depth = 1; depth <= 10; depth++) {
      const created = await owner.create(parentId, `Carpeta ${depth}`);
      expect(created.statusCode, created.body).toBe(201);
      const child = created.json().resource;
      expect(child).toMatchObject({ ownerId: owner.id, parentId, kind: 'FOLDER' });
      expect((await owner.list(parentId)).json().items).toEqual([child]);
      parentId = child.id;
    }
    expect((await owner.list(parentId)).json().items).toEqual([]);
    expect((await owner.create(parentId, 'Fuera de rango')).json().code).toBe('DEPTH_EXCEEDED');
    expect((await owner.reserve(parentId, 'fuera.txt')).json().code).toBe('DEPTH_EXCEEDED');
  });

  it('valida sesión, CSRF, nombres y unicidad compartida con archivos', async () => {
    const owner = await folderSession(app);
    const request = {
      method: 'POST' as const,
      url: '/api/v1/folders',
      payload: { parentId: owner.rootId, name: 'Prueba' },
    };
    expect((await app.inject(request)).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          ...request,
          headers: {
            cookie: owner.headers.cookie,
            origin: owner.headers.origin,
          },
        })
      ).statusCode,
    ).toBe(403);
    for (const name of [' ', '..', 'a/b', 'a\u0000b', 'x'.repeat(121)]) {
      expect((await owner.create(owner.rootId, name)).statusCode).toBe(400);
    }
    const [folder, upload] = await Promise.all([
      owner.create(owner.rootId, 'A\u0301RBOL.txt'),
      owner.reserve(owner.rootId, 'árbol.txt'),
    ]);
    expect([folder.statusCode, upload.statusCode].sort()).toEqual([201, 409]);
    expect((await owner.create(owner.rootId, '  Árbol.TXT  ')).json().code).toBe('NAME_CONFLICT');
  });

  it('protege ubicaciones privadas y bloquea escrituras con READ y EDIT', async () => {
    const owner = await folderSession(app);
    const other = await folderSession(app);
    const parent = (await owner.create(owner.rootId, 'Privada')).json().resource.id;
    const shared = (await owner.create(parent, 'Compartida')).json().resource.id;
    const child = (await owner.create(shared, 'Visible')).json().resource.id;
    expect((await other.create(randomUUID(), 'Nueva')).statusCode).toBe(404);
    expect((await other.create(shared, 'Nueva')).statusCode).toBe(404);
    for (const permission of ['READ', 'EDIT']) {
      await pool.query(
        `INSERT INTO "Share" ("resourceId","userId",permission,"updatedAt")
        VALUES ($1,$2,$3,now()) ON CONFLICT ("resourceId","userId")
        DO UPDATE SET permission = EXCLUDED.permission`,
        [shared, other.id, permission],
      );
      const listing = await other.list(shared);
      expect(listing.json().items.map((item: { id: string }) => item.id)).toEqual([child]);
      expect(listing.body).not.toContain(parent);
      expect((await other.list(parent)).statusCode).toBe(404);
      expect((await other.create(shared, 'Nueva')).statusCode).toBe(403);
      expect((await other.reserve(shared, 'nuevo.txt')).statusCode).toBe(403);
    }
  });

  it('vuelve a comprobar los ancestros tras esperar el bloqueo del propietario', async () => {
    const owner = await folderSession(app);
    const parent = (await owner.create(owner.rootId, 'En eliminación')).json().resource.id;
    const child = (await owner.create(parent, 'Destino')).json().resource.id;
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [owner.id]);
      await markDeleting(db, owner.id, parent);
      const pending = Promise.all([
        owner.create(child, 'Nueva'),
        owner.reserve(child, 'nuevo.txt'),
      ]);
      try {
        const {
          rows: [backend],
        } = await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        await expect
          .poll(async () => {
            const { rowCount } = await db.query(
              'SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
              [backend.pid],
            );
            return rowCount;
          })
          .toBeGreaterThan(0);
      } finally {
        await db.query('COMMIT');
        await pending;
      }
      expect((await pending).map((response) => response.statusCode)).toEqual([404, 404]);
      expect((await owner.list(child)).statusCode).toBe(404);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });
});
