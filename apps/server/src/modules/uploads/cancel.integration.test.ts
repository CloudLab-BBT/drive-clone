import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { cleanupCancellation, requestCancellation } from './cancel.ts';
import { processUpload, renew } from './process.ts';
import { UploadStore } from './store.ts';

const suite = process.env.RUN_UPLOAD_FAILURES === 'true' ? describe : describe.skip;
suite('cancelación persistente de cargas', () => {
  afterAll(async () => {
    await closeClients();
  });
  const store = new UploadStore(pool);
  async function actor() {
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
  async function queued(userId: string, rootId: string) {
    const bytes = Buffer.from('%PDF-1.7\ncancelación\n%%EOF\n');
    const row = await store.create(userId, {
      parentId: rootId,
      name: `${randomUUID()}.pdf`,
      size: bytes.length,
    });
    await store.start(row.id, userId);
    const key = `${randomUUID()}.ready`;
    await writeFile(join(config.tempDir, key), bytes);
    await store.queue(
      row.id,
      userId,
      key,
      bytes.length,
      createHash('sha256').update(bytes).digest('hex'),
    );
    return row;
  }

  it('cancela CREATED y QUEUED, repite sin liberar dos veces y aísla propietarios', async () => {
    const owner = await actor();
    const other = await actor();
    const created = await store.create(owner.userId, {
      parentId: owner.rootId,
      name: `${randomUUID()}.pdf`,
      size: 10,
    });
    await expect(requestCancellation(created.id, other.userId)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect((await requestCancellation(created.id, owner.userId)).status).toBe('CANCEL_REQUESTED');
    await cleanupCancellation(created.id);
    expect((await store.get(created.id, owner.userId)).status).toBe('CANCELLED');
    await requestCancellation(created.id, owner.userId);
    const pending = await queued(owner.userId, owner.rootId);
    await requestCancellation(pending.id, owner.userId);
    await cleanupCancellation(pending.id);
    expect(await processUpload(pending.id)).toBe(true);
    expect((await store.get(pending.id, owner.userId)).status).toBe('CANCELLED');
    const quota = await pool.query<{ reservedBytes: string }>(
      'SELECT "reservedBytes" FROM "User" WHERE id = $1',
      [owner.userId],
    );
    expect(quota.rows[0].reservedBytes).toBe('0');
  });

  it('mantiene reserva tras fallo de limpieza y la recupera al reintentar', async () => {
    const { userId, rootId } = await actor();
    const row = await queued(userId, rootId);
    const attemptId = randomUUID();
    const objectKey = `uploads/${userId}/${row.id}/${attemptId}`;
    await pool.query(
      `INSERT INTO "UploadAttempt" (id,"uploadId","objectKey",status,"updatedAt")
      VALUES ($1,$2,$3,'WRITING',now())`,
      [attemptId, row.id, objectKey],
    );
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: objectKey, Body: 'residuo' }));
    await requestCancellation(row.id, userId);
    const original = s3.send.bind(s3);
    const spy = vi.spyOn(s3, 'send').mockImplementation((async (command: unknown) => {
      if (command instanceof DeleteObjectCommand) throw new Error('S3 caído');
      return original(command as never);
    }) as typeof s3.send);
    try {
      await cleanupCancellation(row.id);
    } finally {
      spy.mockRestore();
    }
    expect((await store.get(row.id, userId)).status).toBe('CANCEL_REQUESTED');
    expect((await store.get(row.id, userId)).cleanupPending).toBe(true);
    const reserved = await pool.query<{ reservedBytes: string }>(
      'SELECT "reservedBytes" FROM "User" WHERE id = $1',
      [userId],
    );
    expect(BigInt(reserved.rows[0].reservedBytes)).toBeGreaterThan(0n);
    await cleanupCancellation(row.id);
    expect((await store.get(row.id, userId)).status).toBe('CANCELLED');
  }, 30_000);

  it('conserva la reserva si falla borrar el parcial y limpia el ready al reintentar', async () => {
    const { userId, rootId } = await actor();
    const row = await store.create(userId, {
      parentId: rootId,
      name: `${randomUUID()}.pdf`,
      size: 5,
    });
    const receiving = await store.start(row.id, userId);
    const part = join(config.tempDir, receiving.tempKey!);
    const ready = part.replace(/\.part$/, '.ready');
    await writeFile(part, 'parcial');
    await writeFile(ready, 'listo');
    await requestCancellation(row.id, userId);
    await cleanupCancellation(row.id, true, async () => {
      throw new Error('borrado falló');
    });
    const pending = await store.get(row.id, userId);
    expect(pending.status).toBe('CANCEL_REQUESTED');
    expect(pending.cleanupPending).toBe(true);
    const reserved = await pool.query<{ reservedBytes: string }>(
      'SELECT "reservedBytes" FROM "User" WHERE id = $1',
      [userId],
    );
    expect(reserved.rows[0].reservedBytes).toBe('5');
    await cleanupCancellation(row.id);
    expect((await store.get(row.id, userId)).status).toBe('CANCELLED');
    const after = await pool.query<{ reservedBytes: string }>(
      'SELECT "reservedBytes" FROM "User" WHERE id = $1',
      [userId],
    );
    expect(after.rows[0].reservedBytes).toBe('0');
    await expect(import('node:fs/promises').then(({ stat }) => stat(ready))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
