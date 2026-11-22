import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { pool, closeClients } from '../../platform/clients.ts';
import { AuthorizationService } from './service.ts';

let db: PoolClient;
let access: AuthorizationService;
const owner = randomUUID();
const reader = randomUUID();
const outsider = randomUUID();
const root = randomUUID();
const folder = randomUUID();
const privateSibling = randomUUID();
const child = randomUUID();
const secondChild = randomUUID();
const directOnly = randomUUID();
const deletion = randomUUID();

async function addFolder(id: string, parentId: string | null) {
  await db.query(`
    INSERT INTO "Resource" (id, "ownerId", "parentId", kind, name, "nameKey",
                           "isRoot", status, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'FOLDER', $1::uuid::text, $1::uuid::text,
            $3::uuid IS NULL, 'ACTIVE', '2026-11-22T00:00:00.123456Z', now())
  `, [id, owner, parentId]);
}

async function grant(id: string, permission: 'READ' | 'EDIT') {
  await db.query(`
    INSERT INTO "Share" ("resourceId", "userId", permission, "updatedAt")
    VALUES ($1, $2, $3, now())
  `, [id, reader, permission]);
}

beforeEach(async () => {
  db = await pool.connect();
  await db.query('BEGIN');
  access = new AuthorizationService(db);
  for (const id of [owner, reader, outsider]) {
    await db.query('INSERT INTO "User" (id, username, "passwordHash") VALUES ($1, $2, $3)', [
      id, 't' + id.replaceAll('-', '').slice(0, 20), 'solo-pruebas',
    ]);
  }
  await addFolder(root, null);
  await addFolder(folder, root);
  await addFolder(privateSibling, root);
  await addFolder(child, folder);
  await addFolder(secondChild, folder);
  await addFolder(directOnly, privateSibling);
  await grant(folder, 'READ');
  await grant(child, 'EDIT');
  await grant(directOnly, 'READ');
});

afterEach(async () => {
  if (!db) return;
  try {
    await db.query('ROLLBACK');
  } finally {
    db.release();
  }
});
afterAll(closeClients);

describe('Autorización sobre PostgreSQL', () => {
  it('combina permisos y conserva la vía heredada después de revocar la directa', async () => {
    const input = { actorId: reader, resourceId: child, action: 'DELETE' } as const;
    expect(await access.evaluate(input)).toMatchObject({ allowed: true, effectivePermission: 'EDIT' });
    await db.query('DELETE FROM "Share" WHERE "resourceId" = $1 AND "userId" = $2', [child, reader]);
    expect(await access.evaluate(input)).toMatchObject({ allowed: false, effectivePermission: 'READ' });
  });

  it('oculta raíz, hermanos, ancestros privados y recursos inexistentes', async () => {
    for (const resourceId of [root, privateSibling, randomUUID()]) {
      expect(await access.evaluate({ actorId: reader, resourceId, action: 'VIEW' })).toEqual({
        visible: false, allowed: false, effectivePermission: null,
      });
    }
    expect(await access.listChildren(reader, privateSibling)).toBeNull();
    expect(await access.listChildren(outsider, folder)).toBeNull();
    expect(await access.listChildren(owner, secondChild)).toEqual({ items: [], next: null });
    const shared = await access.listShared(reader);
    expect(shared.items.map(item => item.id).sort()).toEqual([folder, child, directOnly].sort());
    expect(shared.items.every(item => !('parentId' in item))).toBe(true);
  });

  it('pagina de forma estable y preserva la precisión del cursor', async () => {
    const first = await access.listChildren(reader, folder, { limit: 1 });
    expect(first?.next?.createdAt).toBe('2026-11-22T00:00:00.123456Z');
    const second = await access.listChildren(reader, folder, { limit: 1, after: first?.next ?? undefined });
    expect(second?.next).toBeNull();
    expect([first?.items[0]?.id, second?.items[0]?.id]).toEqual([child, secondChild].sort());
  });

  it('deniega lectura y destino de carga para un archivo reservado', async () => {
    const id = randomUUID();
    await db.query(`
      INSERT INTO "Resource" (id, "ownerId", "parentId", kind, name, "nameKey", status, "updatedAt")
      VALUES ($1, $2, $3, 'FILE', 'pendiente.pdf', 'pendiente.pdf', 'RESERVED', now())
    `, [id, owner, folder]);
    for (const action of ['VIEW', 'DOWNLOAD', 'CREATE_CHILD'] as const) {
      expect(await access.evaluate({ actorId: owner, resourceId: id, action }))
        .toMatchObject({ visible: false, allowed: false });
    }
    expect((await access.listChildren(owner, folder))?.items.map(row => row.id)).not.toContain(id);
  });

  it('la base rechaza un hijo con propietario distinto al de su carpeta', async () => {
    await expect(db.query(`
      INSERT INTO "Resource" (id, "ownerId", "parentId", kind, name, "nameKey", status, "updatedAt")
      VALUES ($1, $2, $3, 'FOLDER', 'otra', 'otra', 'ACTIVE', now())
    `, [randomUUID(), reader, folder])).rejects.toMatchObject({ code: '23503' });
  });

  it('mantiene la herencia en el décimo nivel permitido', async () => {
    let parent = folder;
    for (let level = 2; level <= 10; level++) {
      const id = randomUUID();
      await addFolder(id, parent);
      parent = id;
    }
    expect(await access.evaluate({ actorId: reader, resourceId: parent, action: 'VIEW' }))
      .toEqual({ visible: true, allowed: true, effectivePermission: 'READ' });
  });

  it('oculta descendientes de un ancestro en eliminación incluso al propietario', async () => {
    await db.query(`
      INSERT INTO "Deletion" (id, "resourceId", "ownerId", "requestedById", status,
                              "affectedResources", "updatedAt")
      VALUES ($1, $2, $3, $3, 'PENDING', 1, now())
    `, [deletion, folder, owner]);
    await db.query('UPDATE "Resource" SET status = $1, "deletionId" = $2 WHERE id = $3', [
      'DELETING', deletion, folder,
    ]);
    expect(await access.evaluate({ actorId: owner, resourceId: child, action: 'CREATE_CHILD' }))
      .toMatchObject({ visible: false, allowed: false });
    expect(await access.listChildren(reader, folder)).toBeNull();
    expect((await access.listShared(reader)).items.map(item => item.id)).toEqual([directOnly]);
  });
});
