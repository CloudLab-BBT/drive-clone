import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { processUpload, renew } from './process.ts';
import { publishOutbox } from './queue.ts';
import { UploadStore } from './store.ts';

const suite = process.env.RUN_UPLOAD_FAILURES === 'true' ? describe : describe.skip;

suite('fallos controlados de publicación y S3', () => {
  afterAll(async () => { await closeClients(); });

  it('conserva Outbox y reintenta sin publicar archivo lógico prematuro', async () => {
    const userId = randomUUID();
    const rootId = randomUUID();
    await pool.query('INSERT INTO "User" (id,username,"passwordHash") VALUES ($1,$2,$3)',
      [userId, `t${userId.replaceAll('-', '').slice(0, 20)}`, 'prueba']);
    await pool.query(`INSERT INTO "Resource" (id,"ownerId",kind,name,"nameKey","isRoot",status,"updatedAt")
      VALUES ($1,$2,'FOLDER','Raíz','raíz',true,'ACTIVE',now())`, [rootId, userId]);
    const store = new UploadStore(pool);
    const bytes = Buffer.from('%PDF-1.7\nfallos controlados\n%%EOF\n');
    const created = await store.create(userId, { parentId: rootId, name: 'fallos.pdf', size: bytes.length });
    await store.start(created.id, userId);
    const tempKey = `${randomUUID()}.ready`;
    await writeFile(join(config.tempDir, tempKey), bytes, { flag: 'wx', mode: 0o600 });
    const hash = createHash('sha256').update(bytes).digest('hex');
    await store.queue(created.id, userId, tempKey, bytes.length, hash);

    const queueName = config.queueName;
    config.queueName = `ausente-${randomUUID()}`;
    try { await publishOutbox(); } finally { config.queueName = queueName; }
    const pending = await pool.query<{ publishedAt: Date | null; errorCode: string }>(
      'SELECT "publishedAt","errorCode" FROM "Outbox" WHERE "entityId" = $1', [created.id]);
    expect(pending.rows[0].publishedAt).toBeNull();
    expect(pending.rows[0].errorCode).toBe('PUBLISH_FAILED');
    await pool.query('UPDATE "Outbox" SET "availableAt" = now() WHERE "entityId" = $1', [created.id]);
    await publishOutbox();
    const published = await pool.query<{ publishedAt: Date | null }>(
      'SELECT "publishedAt" FROM "Outbox" WHERE "entityId" = $1', [created.id]);
    expect(published.rows[0].publishedAt).not.toBeNull();

    const bucket = config.bucket;
    config.bucket = `ausente-${randomUUID()}`;
    try { expect(await processUpload(created.id)).toBe(false); }
    finally { config.bucket = bucket; }
    const retry = await store.get(created.id, userId);
    expect(retry.status).toBe('QUEUED');
    expect(retry.attemptCount).toBe(1);
    const reserved = await pool.query<{ status: string }>('SELECT status FROM "Resource" WHERE id = $1',
      [created.resourceId]);
    expect(reserved.rows[0].status).toBe('RESERVED');
    await pool.query('UPDATE "Upload" SET "nextAttemptAt" = now() WHERE id = $1', [created.id]);
    expect(await processUpload(created.id)).toBe(true);
    const completed = await store.get(created.id, userId);
    expect(completed.status).toBe('COMPLETED');
    const object = await pool.query<{ objectKey: string }>('SELECT "objectKey" FROM "Resource" WHERE id = $1',
      [created.resourceId]);
    const received = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: object.rows[0].objectKey }));
    expect(Buffer.from(await received.Body!.transformToByteArray())).toEqual(bytes);
  }, 30_000);

  it('impide publicar si un ancestro entra en eliminación', async () => {
    const userId = randomUUID();
    const rootId = randomUUID();
    const folderId = randomUUID();
    const ancestorId = randomUUID();
    await pool.query('INSERT INTO "User" (id,username,"passwordHash") VALUES ($1,$2,$3)',
      [userId, `t${userId.replaceAll('-', '').slice(0, 20)}`, 'prueba']);
    await pool.query(`INSERT INTO "Resource" (id,"ownerId",kind,name,"nameKey","isRoot",status,"updatedAt")
      VALUES ($1,$2,'FOLDER','Raíz','raíz',true,'ACTIVE',now())`, [rootId, userId]);
    await pool.query(`INSERT INTO "Resource" (id,"ownerId","parentId",kind,name,"nameKey",status,"updatedAt")
      VALUES ($1,$2,$3,'FOLDER','Ancestro','ancestro','ACTIVE',now())`, [ancestorId, userId, rootId]);
    await pool.query(`INSERT INTO "Resource" (id,"ownerId","parentId",kind,name,"nameKey",status,"updatedAt")
      VALUES ($1,$2,$3,'FOLDER','Carpeta','carpeta','ACTIVE',now())`, [folderId, userId, ancestorId]);
    const store = new UploadStore(pool);
    const bytes = Buffer.from('%PDF-1.7\ncontenido\n%%EOF\n');
    const created = await store.create(userId, { parentId: folderId, name: 'ancestro.pdf', size: bytes.length });
    await store.start(created.id, userId);
    const tempKey = `${randomUUID()}.ready`;
    await writeFile(join(config.tempDir, tempKey), bytes);
    await store.queue(created.id, userId, tempKey, bytes.length,
      createHash('sha256').update(bytes).digest('hex'));
    const deletionId = randomUUID();
    await pool.query(`INSERT INTO "Deletion" (id,"resourceId","ownerId","requestedById",status,
      "affectedResources","updatedAt") VALUES ($1,$2,$3,$3,'PENDING',1,now())`,
      [deletionId, ancestorId, userId]);
    await pool.query(`UPDATE "Resource" SET status = 'DELETING', "deletionId" = $2 WHERE id = $1`,
      [ancestorId, deletionId]);
    expect(await processUpload(created.id)).toBe(false);
    expect((await store.get(created.id, userId)).status).toBe('FAILED');
    const resource = await pool.query<{ status: string }>('SELECT status FROM "Resource" WHERE id = $1',
      [created.resourceId]);
    expect(resource.rows).toHaveLength(0);
  }, 30_000);

  it('renueva solo el lease del intento activo', async () => {
    const userId = randomUUID();
    const rootId = randomUUID();
    const attemptId = randomUUID();
    await pool.query('INSERT INTO "User" (id,username,"passwordHash") VALUES ($1,$2,$3)',
      [userId, `t${userId.replaceAll('-', '').slice(0, 20)}`, 'prueba']);
    await pool.query(`INSERT INTO "Resource" (id,"ownerId",kind,name,"nameKey","isRoot",status,"updatedAt")
      VALUES ($1,$2,'FOLDER','Raíz','raíz',true,'ACTIVE',now())`, [rootId, userId]);
    const created = await new UploadStore(pool).create(userId,
      { parentId: rootId, name: 'lease.pdf', size: 1 });
    await pool.query(`UPDATE "Upload" SET status = 'PROCESSING', "attemptId" = $2,
      "leaseUntil" = now() + interval '5 seconds' WHERE id = $1`, [created.id, attemptId]);
    expect(await renew(created.id, randomUUID())).toBe(false);
    expect(await renew(created.id, attemptId)).toBe(true);
    const lease = await pool.query<{ remaining: number }>(`SELECT EXTRACT(EPOCH FROM
      "leaseUntil" - now())::integer AS remaining FROM "Upload" WHERE id = $1`, [created.id]);
    expect(lease.rows[0].remaining).toBeGreaterThan(50);
  });
});
