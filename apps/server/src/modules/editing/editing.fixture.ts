import { randomUUID, createHash } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { folderSession } from '../folders/folder-session.fixture.ts';

export async function editingSession(app: FastifyInstance) {
  const actor = await folderSession(app);
  const {
    rows: [identity],
  } = await pool.query<{ username: string }>('SELECT username FROM "User" WHERE id = $1', [
    actor.id,
  ]);
  return {
    ...actor,
    ...identity,
    rename: (id: string, name: string) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: actor.headers,
        payload: { name },
      }),
    remove: (id: string, confirmed = true) =>
      app.inject({
        method: 'DELETE',
        url: `/api/v1/resources/${id}?confirmRecursive=${confirmed}`,
        headers: actor.headers,
      }),
    deletion: (id: string) =>
      app.inject({ url: `/api/v1/deletions/${id}`, headers: actor.headers }),
    share: (id: string, username: string, permission: 'EDIT' | 'READ') =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/resources/${id}/shares`,
        headers: actor.headers,
        payload: { username, permission },
      }),
    download: (id: string) =>
      app.inject({ url: `/api/v1/files/${id}/download`, headers: actor.headers }),
  };
}

export async function storedFile(ownerId: string, parentId: string, name = 'informe.txt') {
  const id = randomUUID();
  const key = `tests/o12/${id}`;
  const bytes = Buffer.from('Contenido de prueba O12');
  await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes }));
  await pool.query(
    `INSERT INTO "Resource" (id,"ownerId","parentId",kind,name,"nameKey",status,
      size,"mimeType",sha256,"objectKey","updatedAt")
    VALUES ($1,$2,$3,'FILE',$4::text,lower($4::text),'ACTIVE',$5,'text/plain',$6,$7,now())`,
    [
      id,
      ownerId,
      parentId,
      name,
      bytes.length,
      createHash('sha256').update(bytes).digest('hex'),
      key,
    ],
  );
  await pool.query('UPDATE "User" SET "usedBytes" = "usedBytes" + $2 WHERE id = $1', [
    ownerId,
    bytes.length,
  ]);
  return { id, key, bytes };
}
