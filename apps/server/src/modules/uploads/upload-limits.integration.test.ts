import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { closeClients, pool } from '../../platform/clients.ts';
import type { FastifyInstance } from 'fastify';

const suite = process.env.RUN_UPLOAD_INTEGRATION === 'true' ? describe : describe.skip;
const origin = 'http://127.0.0.1:8080';
suite('límites atómicos de reservas O09', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  async function actor() {
    const csrf = await app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    const cookie0 = String(csrf.headers['set-cookie']).split(';')[0];
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { cookie: cookie0, origin, 'x-csrf-token': csrf.json().csrfToken },
      payload: {
        username: `l${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        password: 'clave-larga-de-prueba-123456',
      },
    });
    const cookie = String(response.headers['set-cookie']).split(';')[0];
    const fresh = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/csrf',
      headers: { cookie },
    });
    return {
      cookie,
      userId: response.json().user.id as string,
      rootId: response.json().user.rootId as string,
      headers: { cookie, origin, 'x-csrf-token': fresh.json().csrfToken as string },
    };
  }

  it('acepta exactamente 100 MiB y rechaza 100 MiB más un byte', async () => {
    const user = await actor();
    const create = (size: number) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        headers: user.headers,
        payload: { parentId: user.rootId, name: `${randomUUID()}.pdf`, size },
      });
    const accepted = await create(104857600);
    expect(accepted.statusCode).toBe(201);
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/uploads/${accepted.json().upload.id}/cancel`,
      headers: user.headers,
    });
    expect(cancelled.statusCode).toBe(200);
    const rejected = await create(104857601);
    expect([rejected.statusCode, rejected.json().code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
  });

  it('serializa reservas concurrentes frente a la cuota almacenada más reservada', async () => {
    const user = await actor();
    await pool.query('UPDATE "User" SET "usedBytes" = 1073741760 WHERE id = $1', [user.userId]);
    const create = (name: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        headers: user.headers,
        payload: { parentId: user.rootId, name: `${name}.pdf`, size: 40 },
      });
    const results = await Promise.all([create('quota-a'), create('quota-b')]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.statusCode === 409)!.json().code).toBe('QUOTA_EXCEEDED');
    const created = results.find((result) => result.statusCode === 201)!.json().upload.id as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/uploads/${created}/cancel`,
      headers: user.headers,
    });
    await pool.query('UPDATE "User" SET "usedBytes" = 0 WHERE id = $1', [user.userId]);
  });

  it('limita el polling agrupado a una consulta por segundo y usuario', async () => {
    const user = await actor();
    const request = () =>
      app.inject({
        method: 'GET',
        url: '/api/v1/uploads?active=true',
        headers: { cookie: user.cookie },
      });
    expect((await request()).statusCode).toBe(200);
    const limited = await request();
    expect([limited.statusCode, limited.headers['retry-after']]).toEqual([429, '1']);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect((await request()).statusCode).toBe(200);
  });
});
