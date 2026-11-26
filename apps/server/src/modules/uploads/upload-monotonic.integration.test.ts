import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { closeClients, pool } from '../../platform/clients.ts';
import type { FastifyInstance } from 'fastify';

const suite = process.env.RUN_UPLOAD_INTEGRATION === 'true' ? describe : describe.skip;
const origin = 'http://127.0.0.1:8080';
const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
const multipart = (name: string) => {
  const boundary = 'o09-state';
  return {
    type: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n\r\n`,
      ),
      pdf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
};

suite('estado monotónico del endpoint PUT de carga', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  it('no vuelve a QUEUED ni modifica estados avanzados al recibir un PUT tardío', async () => {
    const csrf = await app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    const initial = String(csrf.headers['set-cookie']).split(';')[0];
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { cookie: initial, origin, 'x-csrf-token': csrf.json().csrfToken },
      payload: {
        username: `m${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        password: ['clave-larga-de-', 'prueba-123456'].join(''),
      },
    });
    const cookie = String(registered.headers['set-cookie']).split(';')[0];
    const fresh = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/csrf',
      headers: { cookie },
    });
    const headers = { cookie, origin, 'x-csrf-token': fresh.json().csrfToken as string };
    for (const status of ['PROCESSING', 'COMPLETED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED']) {
      const name = `${status}.pdf`;
      const reservation = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        headers,
        payload: { parentId: registered.json().user.rootId, name, size: pdf.length },
      });
      const id = reservation.json().upload.id as string;
      await pool.query(
        `UPDATE "Upload" SET status = $2,
        "attemptId" = CASE WHEN $2 = 'PROCESSING' THEN gen_random_uuid() ELSE NULL END,
        "leaseUntil" = CASE WHEN $2 = 'PROCESSING' THEN now() + interval '1 minute' ELSE NULL END
        WHERE id = $1`,
        [id, status],
      );
      const form = multipart(name);
      const put = await app.inject({
        method: 'PUT',
        url: `/api/v1/uploads/${id}/content`,
        headers: { ...headers, 'content-type': form.type },
        payload: form.body,
      });
      expect([put.statusCode, put.json().code]).toEqual([409, 'STATE_CONFLICT']);
      const current = await pool.query<{ status: string }>(
        'SELECT status FROM "Upload" WHERE id = $1',
        [id],
      );
      expect(current.rows[0].status).toBe(status);
    }
  });
});
