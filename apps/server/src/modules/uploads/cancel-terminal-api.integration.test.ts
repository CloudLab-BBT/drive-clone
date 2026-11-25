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
        password: ['clave', 'larga', 'de', 'prueba', '123456'].join('-'),
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
  it('devuelve 200 para FAILED sin cambiar su limpieza y 409 para COMPLETED', async () => {
    const owner = await session();
    const headers = {
      cookie: owner.cookie,
      origin: 'http://127.0.0.1:8080',
      'x-csrf-token': owner.csrf,
    };
    for (const [status, expectedCode] of [
      ['FAILED', 200],
      ['COMPLETED', 409],
    ] as const) {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        headers,
        payload: { parentId: owner.rootId, name: `${randomUUID()}.pdf`, size: 5 },
      });
      const id = created.json().upload.id as string;
      await pool.query('UPDATE "Upload" SET status = $2, "cleanupPending" = true WHERE id = $1', [
        id,
        status,
      ]);
      const result = await app.inject({
        method: 'POST',
        url: `/api/v1/uploads/${id}/cancel`,
        headers,
      });
      expect(result.statusCode).toBe(expectedCode);
      if (status === 'FAILED') {
        expect(result.json().upload.status).toBe('FAILED');
        expect(result.json().upload.cleanupPending).toBe(true);
      } else expect(result.json().code).toBe('STATE_CONFLICT');
    }
  });
});
