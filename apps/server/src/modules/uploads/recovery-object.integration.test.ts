import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { verifyObject } from './object-verify.ts';
import { acquire } from './process-acquire.ts';
import { processUpload } from './process.ts';
import { recoverExpired } from './recovery.ts';
import { queued, store } from './recovery-fixture.ts';

const suite = process.env.RUN_O13_INTEGRATION === 'true' ? describe : describe.skip;
suite('verificación del objeto durante recuperación', () => {
  afterAll(async () => {
    await closeClients();
  });

  it('descarta el objeto corrupto y publica una clave nueva en el reintento', async () => {
    const { upload, userId } = await queued();
    const attempt = await acquire(upload.id);
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: attempt!.objectKey,
        Body: 'contenido corrupto',
      }),
    );
    await pool.query(
      `UPDATE "Upload" SET "leaseUntil" = now() - interval '1 day'
      WHERE id = $1`,
      [upload.id],
    );
    await recoverExpired();
    const state = await store.get(upload.id, userId);
    expect(state.status).toBe('QUEUED');
    expect(state.attemptCount).toBe(1);
    const diagnostic = await pool.query<{ failureCode: string }>(
      'SELECT "failureCode" FROM "UploadAttempt" WHERE id = $1',
      [attempt!.attemptId],
    );
    expect(diagnostic.rows[0].failureCode).toBe('OBJECT_MISMATCH');
    await expect(
      s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: attempt!.objectKey })),
    ).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    });
    await pool.query('UPDATE "Upload" SET "nextAttemptAt" = now() WHERE id = $1', [upload.id]);
    expect(await processUpload(upload.id)).toBe(true);
    const resource = await pool.query<{ objectKey: string }>(
      'SELECT "objectKey" FROM "Resource" WHERE id = $1',
      [upload.resourceId],
    );
    expect(resource.rows[0].objectKey).not.toBe(attempt!.objectKey);
  });

  it('deja PROCESSING intacto si S3 no responde durante la verificación', async () => {
    const { upload, userId } = await queued();
    const attempt = await acquire(upload.id);
    await pool.query(
      `UPDATE "Upload" SET "leaseUntil" = now() - interval '1 day'
      WHERE id = $1`,
      [upload.id],
    );
    const original = s3.send.bind(s3);
    const spy = vi.spyOn(s3, 'send').mockImplementation((async (command: unknown) => {
      if (command instanceof GetObjectCommand && command.input.Key === attempt!.objectKey)
        throw new Error('S3 no disponible');
      return original(command as never);
    }) as typeof s3.send);
    try {
      await expect(recoverExpired()).rejects.toThrow('S3 no disponible');
    } finally {
      spy.mockRestore();
    }
    const state = await store.get(upload.id, userId);
    expect(state.status).toBe('PROCESSING');
    expect(state.attemptId).toBe(attempt!.attemptId);
    await recoverExpired();
    expect((await store.get(upload.id, userId)).status).toBe('QUEUED');
  });

  it('un bucket ausente no se confunde con un objeto ausente', async () => {
    const bucket = config.bucket;
    config.bucket = `ausente-${randomUUID()}`;
    try {
      await expect(verifyObject('inexistente', 1, '0'.repeat(64))).rejects.toMatchObject({
        name: 'NoSuchBucket',
      });
    } finally {
      config.bucket = bucket;
    }
  });

  it('diagnostica destino desaparecido sin dejar PROCESSING perpetuo', async () => {
    const { upload, userId } = await queued();
    const attempt = await acquire(upload.id);
    await pool.query('DELETE FROM "Resource" WHERE id = $1', [upload.resourceId]);
    await pool.query(
      `UPDATE "Upload" SET "leaseUntil" = now() - interval '1 day'
      WHERE id = $1`,
      [upload.id],
    );
    await recoverExpired();
    expect((await store.get(upload.id, userId)).status).toBe('FAILED');
    const diagnostic = await pool.query<{ failureCode: string }>(
      'SELECT "failureCode" FROM "UploadAttempt" WHERE id = $1',
      [attempt!.attemptId],
    );
    expect(diagnostic.rows[0].failureCode).toBe('DESTINATION_UNAVAILABLE');
    expect(await processUpload(upload.id)).toBe(true);
  });

  it('no repite indefinidamente si el destino deja de estar reservado', async () => {
    const { upload, userId, bytes } = await queued();
    const attempt = await acquire(upload.id);
    await s3.send(
      new PutObjectCommand({ Bucket: config.bucket, Key: attempt!.objectKey, Body: bytes }),
    );
    const deletionId = randomUUID();
    await pool.query(
      `INSERT INTO "Deletion" (id,"resourceId","ownerId","requestedById",
      status,"affectedResources","updatedAt") VALUES ($1,$2,$3,$3,'PENDING',1,now())`,
      [deletionId, upload.resourceId, userId],
    );
    await pool.query(
      `UPDATE "Resource" SET status = 'DELETING', "deletionId" = $2
      WHERE id = $1`,
      [upload.resourceId, deletionId],
    );
    await pool.query(
      `UPDATE "Upload" SET "leaseUntil" = now() - interval '1 day'
      WHERE id = $1`,
      [upload.id],
    );
    await recoverExpired();
    expect((await store.get(upload.id, userId)).status).toBe('FAILED');
    const diagnostic = await pool.query<{ failureCode: string }>(
      'SELECT "failureCode" FROM "UploadAttempt" WHERE id = $1',
      [attempt!.attemptId],
    );
    expect(diagnostic.rows[0].failureCode).toBe('PUBLISH_CONFLICT');
  });
});
