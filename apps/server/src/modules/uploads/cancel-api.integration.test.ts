import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { closeClients, pool } from '../../platform/clients.ts';
import { cleanupCancellation } from './cancel.ts';

const suite = process.env.RUN_UPLOAD_INTEGRATION === 'true' ? describe : describe.skip;
suite('contrato HTTP de cancelación', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });
  async function session() {
    const csrf = await app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    const initialCookie = String(csrf.headers['set-cookie']).split(';')[0];
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: {
        cookie: initialCookie,
        origin: 'http://127.0.0.1:8080',
        'x-csrf-token': csrf.json().csrfToken,
      },
      payload: {
        username: `u${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        password: 'clave-larga-de-prueba-123456',
      },
    });
    expect(registered.statusCode).toBe(201);
    const cookie = String(registered.headers['set-cookie']).split(';')[0];
    const fresh = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/csrf',
      headers: { cookie },
    });
    return {
      cookie,
      csrf: fresh.json().csrfToken as string,
      rootId: registered.json().user.rootId as string,
    };
  }
  it('exige sesión, propietario y CSRF; repite la cancelación y rechaza COMPLETED', async () => {
    const owner = await session();
    const other = await session();
    const headers = {
      cookie: owner.cookie,
      origin: 'http://127.0.0.1:8080',
      'x-csrf-token': owner.csrf,
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads',
      headers,
      payload: { parentId: owner.rootId, name: `${randomUUID()}.pdf`, size: 5 },
    });
    const id = created.json().upload.id as string;
    const url = `/api/v1/uploads/${id}/cancel`;
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url, headers: { cookie: owner.cookie } })).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { cookie: other.cookie, origin: headers.origin, 'x-csrf-token': other.csrf },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/uploads/${id}`,
          headers: { cookie: other.cookie },
        })
      ).statusCode,
    ).toBe(404);
    const first = await app.inject({ method: 'POST', url, headers });
    expect(first.statusCode).toBe(200);
    expect(first.json().upload.status).toBe('CANCELLED');
    expect((await app.inject({ method: 'POST', url, headers })).json().upload.status).toBe(
      'CANCELLED',
    );
    const late = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads',
      headers,
      payload: { parentId: owner.rootId, name: `${randomUUID()}.pdf`, size: 5 },
    });
    const lateId = late.json().upload.id as string;
    await pool.query(`UPDATE "Upload" SET status = 'COMPLETED' WHERE id = $1`, [lateId]);
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/uploads/${lateId}/cancel`,
      headers,
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().code).toBe('STATE_CONFLICT');
  });
  it('mantiene RECEIVING pendiente hasta detener la recepción', async () => {
    const owner = await session();
    const headers = {
      cookie: owner.cookie,
      origin: 'http://127.0.0.1:8080',
      'x-csrf-token': owner.csrf,
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads',
      headers,
      payload: { parentId: owner.rootId, name: `${randomUUID()}.pdf`, size: 5 },
    });
    const id = created.json().upload.id as string;
    await pool.query(`UPDATE "Upload" SET status = 'RECEIVING' WHERE id = $1`, [id]);
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/uploads/${id}/cancel`,
      headers,
    });
    expect(cancelled.json().upload.status).toBe('CANCEL_REQUESTED');
    expect(cancelled.json().upload.cleanupPending).toBe(true);
    await cleanupCancellation(id, true);
    const final = await app.inject({
      method: 'GET',
      url: `/api/v1/uploads/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(final.json().upload.status).toBe('CANCELLED');
  });
});
