import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { closeClients, s3, pool } from '../../platform/clients.ts';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../../platform/config.ts';
import { samples } from './format-fixtures.ts';
import type { FastifyInstance } from 'fastify';

const suite = process.env.RUN_UPLOAD_INTEGRATION === 'true' ? describe : describe.skip;
const origin = 'http://127.0.0.1:8080';
function multipart(name: string, bytes: Buffer) {
  const boundary = 'o09-format';
  return {
    type: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

suite('O09 transferencia y descarga sin alterar bytes', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  it('sube y descarga una muestra real de cada formato', async () => {
    const csrf = await app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    const initialCookie = String(csrf.headers['set-cookie']).split(';')[0];
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { cookie: initialCookie, origin, 'x-csrf-token': csrf.json().csrfToken },
      payload: {
        username: `o${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        password: 'clave-larga-de-prueba-123456',
      },
    });
    const cookie = String(registered.headers['set-cookie']).split(';')[0];
    const token = (
      await app.inject({ method: 'GET', url: '/api/v1/auth/csrf', headers: { cookie } })
    ).json().csrfToken;
    const headers = { cookie, origin, 'x-csrf-token': token as string };
    for (const [extension, bytes] of Object.entries(samples)) {
      const name = `o09-${randomUUID()}.${extension}`;
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        headers,
        payload: { parentId: registered.json().user.rootId, name, size: bytes.length },
      });
      expect(created.statusCode, extension).toBe(201);
      const id = created.json().upload.id as string;
      const form = multipart(name, bytes);
      const received = await app.inject({
        method: 'PUT',
        url: `/api/v1/uploads/${id}/content`,
        headers: { ...headers, 'content-type': form.type },
        payload: form.body,
      });
      expect(received.statusCode, extension).toBe(202);
      let upload = received.json().upload;
      for (let attempt = 0; attempt < 100 && upload.status !== 'COMPLETED'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        upload = (
          await app.inject({ method: 'GET', url: `/api/v1/uploads/${id}`, headers: { cookie } })
        ).json().upload;
        if (upload.status === 'FAILED') throw new Error(`Worker rechazó ${extension}`);
      }
      expect(upload.status, extension).toBe('COMPLETED');
      const resource = await pool.query<{ objectKey: string }>(
        'SELECT "objectKey" FROM "Resource" WHERE id = $1',
        [upload.resourceId],
      );
      const object = await s3.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: resource.rows[0].objectKey }),
      );
      expect(Buffer.from(await object.Body!.transformToByteArray()).equals(bytes), extension).toBe(
        true,
      );
      const downloaded = await app.inject({
        method: 'GET',
        url: `/api/v1/files/${upload.resourceId}/download`,
        headers: { cookie },
      });
      expect(Buffer.from(downloaded.rawPayload).equals(bytes), extension).toBe(true);
    }
    const name = `engañoso-${randomUUID()}.png`;
    const bytes = Buffer.from('#!/bin/sh\nnot an image');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads',
      headers,
      payload: { parentId: registered.json().user.rootId, name, size: bytes.length },
    });
    const id = created.json().upload.id as string;
    const form = multipart(name, bytes);
    const rejected = await app.inject({
      method: 'PUT',
      url: `/api/v1/uploads/${id}/content`,
      headers: { ...headers, 'content-type': form.type },
      payload: form.body,
    });
    expect([rejected.statusCode, rejected.json().code]).toEqual([415, 'UNSUPPORTED_FORMAT']);
  }, 60_000);
});
