import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { encodeCursor } from './cursor.ts';

const suite = process.env.RUN_FILES_INTEGRATION === 'true' ? describe : describe.skip;
suite('listado y descarga O07', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ rateLimit: false }); await app.ready(); });
  afterAll(async () => { await app.close(); await closeClients(); });

  async function session() {
    const csrf = await app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    const prior = String(csrf.headers['set-cookie']).split(';')[0];
    const username = `u${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/register',
      headers: { cookie: prior, origin: 'http://127.0.0.1:8080',
        'x-csrf-token': csrf.json().csrfToken },
      payload: { username, password: 'clave-larga-de-prueba-123456' } });
    expect(registered.statusCode).toBe(201);
    return { cookie: String(registered.headers['set-cookie']).split(';')[0],
      userId: registered.json().user.id as string, rootId: registered.json().user.rootId as string };
  }

  async function file(ownerId: string, parentId: string, name: string, bytes: Buffer,
    status = 'ACTIVE', offset = 0) {
    const id = randomUUID();
    const key = `tests/o07/${id}`;
    await pool.query(`INSERT INTO "Resource" (id,"ownerId","parentId",kind,name,"nameKey",status,
      size,"mimeType",sha256,"objectKey","createdAt","updatedAt") VALUES
      ($1,$2,$3,'FILE',$4::text,$4::text,$5,$6,'application/pdf',$7,$8,
      now() + $9::integer * interval '1 microsecond',now())`,
    [id, ownerId, parentId, name, status, bytes.length,
      createHash('sha256').update(bytes).digest('hex'), key, offset]);
    return { id, key };
  }

  it('pagina sin duplicados, valida cursor y oculta estados no disponibles', async () => {
    const owner = await session();
    const other = await session();
    const get = (url: string, cookie = owner.cookie) => app.inject({ method: 'GET', url,
      headers: { cookie } });
    const base = `/api/v1/folders/${owner.rootId}/children`;
    const empty = await get(base);
    expect(empty.json()).toEqual({ items: [], nextCursor: null });
    const ids = [];
    for (let i = 0; i < 27; i++) ids.push((await file(owner.userId, owner.rootId,
      `pagina-${i}.pdf`, Buffer.from('%PDF-1.7'), 'ACTIVE', i + 1)).id);
    for (const status of ['RESERVED', 'UNAVAILABLE'])
      await file(owner.userId, owner.rootId, `${status}.pdf`, Buffer.from('%PDF-1.7'), status);
    for (const state of ['CREATED', 'FAILED', 'CANCELLED']) {
      const pending = await file(owner.userId, owner.rootId, `${state}.pdf`,
        Buffer.from('%PDF-1.7'), 'RESERVED');
      await pool.query(`INSERT INTO "Upload" (id,"userId","resourceId","resourceRefId",status,
        "expectedSize","updatedAt") VALUES ($1,$2,$3,$3,$4,8,now())`,
      [randomUUID(), owner.userId, pending.id, state]);
      expect((await get(`/api/v1/files/${pending.id}/download`)).statusCode).toBe(404);
    }
    expect((await get(base)).json().items).toHaveLength(25);
    expect((await get(`${base}?limit=100`)).json().items).toHaveLength(27);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `${base}?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response = await get(url);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      seen.push(...response.json().items.map((item: { id: string }) => item.id));
      cursor = response.json().nextCursor;
    } while (cursor);
    expect(seen).toEqual(ids);
    expect(new Set(seen).size).toBe(27);
    expect((await get(`${base}?limit=101`)).json().code).toBe('INVALID_INPUT');
    expect((await get(`${base}?cursor=!!!`)).json().code).toBe('INVALID_INPUT');
    const invalidDate = encodeCursor({ id: ids[0], createdAt: '2026-02-30T12:00:00.123456Z' },
      `children:${owner.rootId}`);
    const rejectedDate = await get(`${base}?cursor=${invalidDate}`);
    expect([rejectedDate.statusCode, rejectedDate.json().code]).toEqual([400, 'INVALID_INPUT']);
    expect((await get(base, other.cookie)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: base })).statusCode).toBe(401);
    expect((await get(`/api/v1/folders/${ids[0]}/children`)).statusCode).toBe(409);
  }, 30_000);

  it('descarga bytes autorizados sin exponer ancestros privados ni claves S3', async () => {
    const owner = await session();
    const reader = await session();
    const bytes = Buffer.from('%PDF-1.7\ncontenido original O07\n%%EOF\n');
    const folderId = randomUUID();
    await pool.query(`INSERT INTO "Resource" (id,"ownerId","parentId",kind,name,"nameKey",status,"updatedAt")
      VALUES ($1,$2,$3,'FOLDER','Privado','privado','ACTIVE',now())`,
    [folderId, owner.userId, owner.rootId]);
    const shared = await file(owner.userId, folderId, 'informe-á.pdf', bytes);
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: shared.key, Body: bytes }));
    await pool.query(`INSERT INTO "Share" ("resourceId","userId",permission,"updatedAt")
      VALUES ($1,$2,'READ',now())`, [shared.id, reader.userId]);
    const get = (url: string, cookie: string) => app.inject({ method: 'GET', url,
      headers: { cookie } });
    const listed = await get('/api/v1/shared', reader.cookie);
    expect(listed.json().items.map((item: { name: string }) => item.name)).toContain('informe-á.pdf');
    expect(JSON.stringify(listed.json())).not.toContain('Privado');
    expect(JSON.stringify(listed.json())).not.toContain(folderId);
    expect(JSON.stringify(listed.json())).not.toContain(owner.rootId);
    expect(listed.json().items[0]).not.toHaveProperty('parentId');
    expect(JSON.stringify(listed.json())).not.toContain(bytes.toString());
    const url = `/api/v1/files/${shared.id}/download`;
    const downloaded = await get(url, reader.cookie);
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.rawPayload).toEqual(bytes);
    expect(downloaded.headers['content-disposition']).toContain("filename*=UTF-8''informe-%C3%A1.pdf");
    expect(downloaded.headers['cache-control']).toBe('private, no-store');
    expect(downloaded.headers['x-content-type-options']).toBe('nosniff');
    expect(downloaded.headers['content-type']).toContain('application/pdf');
    expect(JSON.stringify(downloaded.headers)).not.toContain(shared.key);
    await pool.query(`UPDATE "Share" SET permission = 'EDIT' WHERE "resourceId" = $1 AND "userId" = $2`,
      [shared.id, reader.userId]);
    expect((await get(url, reader.cookie)).rawPayload).toEqual(bytes);
    const outsider = await session();
    expect((await get(url, outsider.cookie)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await get(`/api/v1/files/${folderId}/download`, owner.cookie)).statusCode).toBe(409);
    const missing = await file(owner.userId, owner.rootId, 'ausente.pdf', bytes);
    const absent = await get(`/api/v1/files/${missing.id}/download`, owner.cookie);
    expect([absent.statusCode, absent.json().code]).toEqual([503, 'DEPENDENCY_UNAVAILABLE']);
    expect(absent.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(absent.json())).not.toContain(missing.key);
    expect((await get(`/api/v1/files/${randomUUID()}/download`, owner.cookie)).statusCode).toBe(404);
    const outage = vi.spyOn(s3, 'send').mockRejectedValueOnce(new Error('S3 apagado'));
    const unavailable = await get(url, owner.cookie);
    outage.mockRestore();
    expect([unavailable.statusCode, unavailable.json().code]).toEqual([503, 'DEPENDENCY_UNAVAILABLE']);
    expect(JSON.stringify(unavailable.json())).not.toContain(shared.key);
    const deletion = randomUUID();
    await pool.query(`INSERT INTO "Deletion" (id,"resourceId","ownerId","requestedById",status,
      "affectedResources","updatedAt") VALUES ($1,$2,$3,$3,'PENDING',2,now())`,
    [deletion, folderId, owner.userId]);
    await pool.query(`UPDATE "Resource" SET status = 'DELETING', "deletionId" = $2 WHERE id = $1`,
      [folderId, deletion]);
    expect((await get(url, reader.cookie)).statusCode).toBe(404);
    expect((await get('/api/v1/shared', reader.cookie)).json().items).toEqual([]);
  }, 30_000);
});
