import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { buildApp } from '../../app.ts';
import { closeClients, pool, s3, sqs } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import type { FastifyInstance } from 'fastify';

const suite = process.env.RUN_UPLOAD_INTEGRATION === 'true' ? describe : describe.skip;
function multipart(bytes: Buffer) {
  const boundary = 'o06-boundary';
  return { body: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="externo.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]), type: `multipart/form-data; boundary=${boundary}` };
}

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
        'x-csrf-token': other.csrf, 'content-type': multipart(bytes).type }, payload: multipart(bytes).body });
    expect(foreignWrite.statusCode).toBe(404);
    const activeOther = await app.inject({ method: 'GET', url: '/api/v1/uploads?active=true',
      headers: { cookie: other.cookie } });
    expect(activeOther.json().items).toEqual([]);
    const received = await app.inject({ method: 'PUT', url: `/api/v1/uploads/${id}/content`,
      headers: { ...headers, 'content-type': multipart(bytes).type }, payload: multipart(bytes).body });
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
      headers: { ...headers, 'content-type': multipart(Buffer.from('xxxx')).type },
      payload: multipart(Buffer.from('xxxx')).body });
    expect(rejected.statusCode).toBe(415);
    const failed = await app.inject({ method: 'GET', url: `/api/v1/uploads/${invalid.json().upload.id}`,
      headers: { cookie: owner.cookie } });
    expect(failed.json().upload.errorCode).toBe('FORMAT_INVALID');
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
    const limited = responses.find((response) => response.statusCode === 429)!;
    expect(limited.json().code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBe('1');
    const active = await app.inject({ method: 'GET', url: '/api/v1/uploads?active=true',
      headers: { cookie: actor.cookie } });
    expect(active.json().items).toHaveLength(10);
  }, 30_000);

  it('exige multipart con un único campo file y errores públicos de O01', async () => {
    const actor = await session();
    const headers = { cookie: actor.cookie, origin: 'http://127.0.0.1:8080',
      'x-csrf-token': actor.csrf };
    const create = async (size = 4) => (await app.inject({ method: 'POST', url: '/api/v1/uploads', headers,
      payload: { parentId: actor.rootId, name: `${randomUUID()}.pdf`, size } })).json().upload.id as string;
    const send = async (id: string, type: string, body: Buffer) => app.inject({ method: 'PUT',
      url: `/api/v1/uploads/${id}/content`, headers: { ...headers, 'content-type': type }, payload: body });
    const raw = await send(await create(), 'application/octet-stream', Buffer.from('xxxx'));
    expect([raw.statusCode, raw.json().code]).toEqual([415, 'UNSUPPORTED_FORMAT']);
    const missing = await send(await create(), multipart(Buffer.alloc(0)).type,
      Buffer.from('--o06-boundary--\r\n'));
    expect([missing.statusCode, missing.json().code]).toEqual([400, 'INVALID_INPUT']);
    const extra = Buffer.from(multipart(Buffer.from('%PDF-')).body.toString().replace(
      '--o06-boundary--\r\n', '--o06-boundary\r\nContent-Disposition: form-data; name="other"\r\n\r\nx\r\n--o06-boundary--\r\n'));
    const rejected = await send(await create(5), multipart(Buffer.from('xxxx')).type, extra);
    expect([rejected.statusCode, rejected.json().code]).toEqual([400, 'INVALID_INPUT']);
    const two = Buffer.from(multipart(Buffer.from('%PDF-')).body.toString().replace('--o06-boundary--\r\n',
      '--o06-boundary\r\nContent-Disposition: form-data; name="file"; filename="dos.pdf"\r\n\r\n%PDF-\r\n--o06-boundary--\r\n'));
    const duplicate = await send(await create(5), multipart(Buffer.alloc(0)).type, two);
    expect([duplicate.statusCode, duplicate.json().code]).toEqual([400, 'INVALID_INPUT']);
    const large = await send(await create(), multipart(Buffer.from('12345')).type,
      multipart(Buffer.from('12345')).body);
    expect([large.statusCode, large.json().code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
  }, 30_000);
});
