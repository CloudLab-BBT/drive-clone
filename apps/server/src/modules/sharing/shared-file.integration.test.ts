import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { AuthorizationService } from '../authorization/service.ts';
import { folderSession } from '../folders/folder-session.fixture.ts';

const suite = process.env.RUN_FILES_INTEGRATION === 'true' ? describe : describe.skip;

suite('O11 concesión y revocación sobre un archivo descargable', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  it('solo permite descargar al receptor mientras tenga READ o EDIT', async () => {
    const [owner, recipient, other] = await Promise.all([
      folderSession(app),
      folderSession(app),
      folderSession(app),
    ]);
    const id = randomUUID();
    const key = `tests/o11/${id}`;
    const bytes = Buffer.from('Archivo compartido de prueba');
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes }));
    await pool.query(
      `INSERT INTO "Resource" (id,"ownerId","parentId",kind,name,"nameKey",status,
        size,"mimeType",sha256,"objectKey","updatedAt")
       VALUES ($1,$2,$3,'FILE','nota.txt','nota.txt','ACTIVE',$4,'text/plain',$5,$6,now())`,
      [
        id,
        owner.id,
        owner.rootId,
        bytes.length,
        createHash('sha256').update(bytes).digest('hex'),
        key,
      ],
    );
    const { rows } = await pool.query<{ username: string }>(
      'SELECT username FROM "User" WHERE id = $1',
      [recipient.id],
    );
    const url = `/api/v1/resources/${id}/shares`;
    const download = (headers: typeof owner.headers) =>
      app.inject({ url: `/api/v1/files/${id}/download`, headers });
    expect((await download(recipient.headers)).statusCode).toBe(404);
    for (const permission of ['EDIT', 'READ'] as const) {
      const grant = await app.inject({
        method: 'PUT',
        url,
        headers: owner.headers,
        payload: { username: rows[0].username, permission },
      });
      expect(grant.statusCode).toBe(200);
      expect((await download(recipient.headers)).rawPayload).toEqual(bytes);
      expect((await download(other.headers)).statusCode).toBe(404);
      const access = new AuthorizationService(pool);
      for (const action of ['RENAME', 'DELETE'] as const) {
        expect(
          (await access.evaluate({ actorId: recipient.id, resourceId: id, action })).allowed,
        ).toBe(permission === 'EDIT');
      }
    }
    const revoked = await app.inject({
      method: 'DELETE',
      url: `${url}/${recipient.id}`,
      headers: owner.headers,
    });
    expect(revoked.json().remainingPermission).toBeNull();
    expect((await download(recipient.headers)).statusCode).toBe(404);
  });
});
