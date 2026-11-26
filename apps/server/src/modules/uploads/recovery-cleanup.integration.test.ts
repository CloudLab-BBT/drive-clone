import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { acquire } from './process-acquire.ts';
import { cleanupDiscarded } from './attempts.ts';
import { cleanupFailed } from './cancel.ts';
import { queued, store } from './recovery-fixture.ts';

const suite = process.env.RUN_O13_INTEGRATION === 'true' ? describe : describe.skip;
suite('residuos y limpieza compartida', () => {
  afterAll(async () => {
    await closeClients();
  });

  it('reintenta un objeto descartado cuando S3 vuelve a responder', async () => {
    const { upload } = await queued();
    const attempt = await acquire(upload.id);
    await s3.send(
      new PutObjectCommand({ Bucket: config.bucket, Key: attempt!.objectKey, Body: 'residuo' }),
    );
    await pool.query(
      `UPDATE "Upload" SET status = 'QUEUED', "attemptId" = NULL,
      "leaseUntil" = NULL WHERE id = $1`,
      [upload.id],
    );
    await pool.query(`UPDATE "UploadAttempt" SET status = 'DISCARDED' WHERE id = $1`, [
      attempt!.attemptId,
    ]);
    const original = s3.send.bind(s3);
    const spy = vi.spyOn(s3, 'send').mockImplementation((async (command: unknown) => {
      if (command instanceof DeleteObjectCommand) throw new Error('S3 no disponible');
      return original(command as never);
    }) as typeof s3.send);
    try {
      await cleanupDiscarded();
    } finally {
      spy.mockRestore();
    }
    const pending = await pool.query<{ status: string }>(
      'SELECT status FROM "UploadAttempt" WHERE id = $1',
      [attempt!.attemptId],
    );
    expect(pending.rows[0].status).toBe('DISCARDED');
    await cleanupDiscarded();
    const cleaned = await pool.query<{ status: string }>(
      'SELECT status FROM "UploadAttempt" WHERE id = $1',
      [attempt!.attemptId],
    );
    expect(cleaned.rows[0].status).toBe('CLEANED');
    await expect(
      s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: attempt!.objectKey })),
    ).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    });
  });

  it('conserva la cuota de FAILED hasta limpiar objeto y temporal', async () => {
    const { upload, userId } = await queued();
    const attempt = await acquire(upload.id);
    await s3.send(
      new PutObjectCommand({ Bucket: config.bucket, Key: attempt!.objectKey, Body: 'residuo' }),
    );
    await pool.query(
      `UPDATE "Upload" SET status = 'FAILED', "cleanupPending" = true,
      "attemptId" = NULL, "leaseUntil" = NULL WHERE id = $1`,
      [upload.id],
    );
    await pool.query(`UPDATE "UploadAttempt" SET status = 'DISCARDED' WHERE id = $1`, [
      attempt!.attemptId,
    ]);
    const original = s3.send.bind(s3);
    const spy = vi.spyOn(s3, 'send').mockImplementation((async (command: unknown) => {
      if (command instanceof DeleteObjectCommand) throw new Error('S3 no disponible');
      return original(command as never);
    }) as typeof s3.send);
    try {
      await cleanupFailed(upload.id);
    } finally {
      spy.mockRestore();
    }
    expect((await store.get(upload.id, userId)).cleanupPending).toBe(true);
    const reserved = await pool.query<{ reservedBytes: string }>(
      'SELECT "reservedBytes" FROM "User" WHERE id = $1',
      [userId],
    );
    expect(BigInt(reserved.rows[0].reservedBytes)).toBeGreaterThan(0n);
    await cleanupFailed(upload.id);
    expect((await store.get(upload.id, userId)).cleanupPending).toBe(false);
    const released = await pool.query<{ reservedBytes: string }>(
      'SELECT "reservedBytes" FROM "User" WHERE id = $1',
      [userId],
    );
    expect(released.rows[0].reservedBytes).toBe('0');
  });
});
