import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { closeClients } from '../../platform/clients.ts';
import { officeSample } from './office-fixtures.ts';
import type { FastifyInstance } from 'fastify';

const suite = process.env.RUN_UPLOAD_INTEGRATION === 'true' ? describe : describe.skip;
const origin = 'http://127.0.0.1:8080';
const password = ['clave-larga-de-', 'prueba-123456'].join('');
function multipart(name: string, bytes: Buffer) {
  const boundary = 'o09-zip';
  return {
    type: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

suite('rechazo HTTP de ZIP Office inseguro', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  it('responde 415 UNSUPPORTED_FORMAT para entradas cifradas y ratios >100:1', async () => {
    const csrf = await app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    const initial = String(csrf.headers['set-cookie']).split(';')[0];
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { cookie: initial, origin, 'x-csrf-token': csrf.json().csrfToken },
      payload: { username: `z${randomUUID().replaceAll('-', '').slice(0, 20)}`, password },
    });
    const cookie = String(registered.headers['set-cookie']).split(';')[0];
    const fresh = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/csrf',
      headers: { cookie },
    });
    const headers = { cookie, origin, 'x-csrf-token': fresh.json().csrfToken as string };
    const cases: Array<[string, Buffer]> = [
      ['encrypted', officeSample('docx', { encrypted: true })],
      ['ratio', officeSample('docx', { compressionRatio: true })],
    ];
    for (const [label, bytes] of cases) {
      const name = `${label}-${randomUUID()}.docx`;
      const reserved = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        headers,
        payload: { parentId: registered.json().user.rootId, name, size: bytes.length },
      });
      const form = multipart(name, bytes);
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/uploads/${reserved.json().upload.id}/content`,
        headers: { ...headers, 'content-type': form.type },
        payload: form.body,
      });
      expect([response.statusCode, response.json().code]).toEqual([415, 'UNSUPPORTED_FORMAT']);
    }
  });
});
