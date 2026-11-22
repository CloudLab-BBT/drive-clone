import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { buildApp } from '../../app.ts';
import { closeClients, pool, s3, sqs } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import type { FastifyInstance } from 'fastify';

const suite = process.env.RUN_UPLOAD_INTEGRATION === 'true' ? describe : describe.skip;

suite('primera carga real por cola', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ rateLimit: false }); await app.ready(); });
  afterAll(async () => { await app.close(); await closeClients(); });

  async function session() {
    const csrf = await app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    const initialCookie = String(csrf.headers['set-cookie']).split(';')[0];
    const username = `u${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/register',
      headers: { cookie: initialCookie, origin: 'http://127.0.0.1:8080',
        'x-csrf-token': csrf.json().csrfToken },
      payload: { username, password: 'clave-larga-de-prueba-123456' } });
    expect(registered.statusCode).toBe(201);
    const cookie = String(registered.headers['set-cookie']).split(';')[0];
    const fresh = await app.inject({ method: 'GET', url: '/api/v1/auth/csrf', headers: { cookie } });
    return { cookie, csrf: fresh.json().csrfToken as string,
      rootId: registered.json().user.rootId as string };
  }

  it('transfiere bytes iguales, aísla consultas y rechaza contenido inválido', async () => {
    const owner = await session();
    const other = await session();
    const bytes = Buffer.from('%PDF-1.7\ncontenido de prueba O06\n%%EOF\n');
    const headers = { cookie: owner.cookie, origin: 'http://127.0.0.1:8080',
      'x-csrf-token': owner.csrf };
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/uploads?active=true' });
    expect(anonymous.statusCode).toBe(401);
    const oversized = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers,
      payload: { parentId: owner.rootId, name: 'demasiado.pdf', size: 100 * 1024 * 1024 + 1 } });
    expect(oversized.statusCode).toBe(413);
    const name = `prueba-${randomUUID()}.pdf`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers,
      payload: { parentId: owner.rootId, name, size: bytes.length } });
    expect(created.statusCode).toBe(201);
    const id = created.json().upload.id as string;
    const duplicateName = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers,
      payload: { parentId: owner.rootId, name, size: bytes.length } });
    expect(duplicateName.statusCode).toBe(409);
    const forbidden = await app.inject({ method: 'GET', url: `/api/v1/uploads/${id}`,
      headers: { cookie: other.cookie } });
    expect(forbidden.statusCode).toBe(404);
    const foreignWrite = await app.inject({ method: 'PUT', url: `/api/v1/uploads/${id}/content`,
      headers: { cookie: other.cookie, origin: 'http://127.0.0.1:8080',
        'x-csrf-token': other.csrf, 'content-type': 'application/octet-stream' }, payload: bytes });
    expect(foreignWrite.statusCode).toBe(404);
    const activeOther = await app.inject({ method: 'GET', url: '/api/v1/uploads?active=true',
      headers: { cookie: other.cookie } });
    expect(activeOther.json().items).toEqual([]);
    const received = await app.inject({ method: 'PUT', url: `/api/v1/uploads/${id}/content`,
      headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: bytes });
    expect(received.statusCode).toBe(202);
    expect(received.json().upload.status).toBe('QUEUED');
    let status = 'QUEUED';
    for (let i = 0; i < 100 && status !== 'COMPLETED'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const current = await app.inject({ method: 'GET', url: `/api/v1/uploads/${id}`,
        headers: { cookie: owner.cookie } });
      status = current.json().upload.status;
      if (status === 'FAILED') throw new Error('El trabajador declaró la carga fallida');
    }
    expect(status).toBe('COMPLETED');
    const resource = await pool.query<{ objectKey: string; sha256: string }>(
      'SELECT "objectKey",sha256 FROM "Resource" WHERE id = $1', [created.json().upload.resourceId]);
    expect(resource.rows).toHaveLength(1);
    const object = await s3.send(new GetObjectCommand({ Bucket: config.bucket,
      Key: resource.rows[0].objectKey }));
    expect(Buffer.from(await object.Body!.transformToByteArray())).toEqual(bytes);
    expect(resource.rows[0].sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const queue = await sqs.send(new GetQueueUrlCommand({ QueueName: config.queueName }));
    await sqs.send(new SendMessageCommand({ QueueUrl: queue.QueueUrl,
      MessageBody: JSON.stringify({ version: 1, type: 'UPLOAD', id }) }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const count = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "Resource" WHERE id = $1', [created.json().upload.resourceId]);
    expect(count.rows[0].count).toBe('1');
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers,
      payload: { parentId: owner.rootId, name: `invalido-${randomUUID()}.pdf`, size: 4 } });
    const rejected = await app.inject({ method: 'PUT',
      url: `/api/v1/uploads/${invalid.json().upload.id}/content`,
      headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: Buffer.from('xxxx') });
    expect(rejected.statusCode).toBe(415);
    const quota = await pool.query<{ reservedBytes: string }>(`SELECT "reservedBytes" FROM "User"
      WHERE id = (SELECT "ownerId" FROM "Resource" WHERE id = $1)`, [owner.rootId]);
    expect(quota.rows[0].reservedBytes).toBe('0');
  }, 40_000);

  it('reserva atómicamente el máximo de cargas simultáneas', async () => {
    const actor = await session();
    const headers = { cookie: actor.cookie, origin: 'http://127.0.0.1:8080',
      'x-csrf-token': actor.csrf };
    const responses = await Promise.all(Array.from({ length: 11 }, (_, index) =>
      app.inject({ method: 'POST', url: '/api/v1/uploads', headers,
        payload: { parentId: actor.rootId, name: `concurrente-${index}.pdf`, size: 1 } })));
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(10);
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(1);
    const active = await app.inject({ method: 'GET', url: '/api/v1/uploads?active=true',
      headers: { cookie: actor.cookie } });
    expect(active.json().items).toHaveLength(10);
  }, 30_000);
});
