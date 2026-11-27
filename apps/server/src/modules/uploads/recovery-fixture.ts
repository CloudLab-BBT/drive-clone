import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { UploadStore } from './store.ts';

export const store = new UploadStore(pool);
export async function actor() {
  const userId = randomUUID();
  const rootId = randomUUID();
  await pool.query('INSERT INTO "User" (id,username,"passwordHash") VALUES ($1,$2,$3)', [
    userId,
    `t${userId.replaceAll('-', '').slice(0, 20)}`,
    'prueba',
  ]);
  await pool.query(
    `INSERT INTO "Resource" (id,"ownerId",kind,name,"nameKey","isRoot",status,"updatedAt")
    VALUES ($1,$2,'FOLDER','Raíz','raíz',true,'ACTIVE',now())`,
    [rootId, userId],
  );
  return { userId, rootId };
}

export async function queued(name = 'recuperacion.pdf') {
  const { userId, rootId } = await actor();
  const bytes = Buffer.from('%PDF-1.7\nrecuperación O13\n%%EOF\n');
  const upload = await store.create(userId, {
    parentId: rootId,
    name: `${randomUUID()}-${name}`,
    size: bytes.length,
  });
  await store.start(upload.id, userId);
  const key = `${randomUUID()}.ready`;
  await writeFile(join(config.tempDir, key), bytes);
  await store.queue(
    upload.id,
    userId,
    key,
    bytes.length,
    createHash('sha256').update(bytes).digest('hex'),
  );
  return { upload, userId, rootId, bytes, key };
}
