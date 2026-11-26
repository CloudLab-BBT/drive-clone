import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { acquire } from './process-acquire.ts';
import { processUpload } from './process.ts';
import { recoverExpired } from './recovery.ts';
import { actor, queued, store } from './recovery-fixture.ts';
import { cleanupCancellation, requestCancellation } from './cancel.ts';

const suite = process.env.RUN_O13_INTEGRATION === 'true' ? describe : describe.skip;
suite('recuperación de intentos y objetos', () => {
  afterAll(async () => {
    await closeClients();
  });

  it('recupera el mismo objeto tras S3 y antes de confirmar SQL', async () => {
    const { upload, userId, bytes, key } = await queued();
    const job = await acquire(upload.id);
    expect(job).not.toBeNull();
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: job!.objectKey,
        Body: await readFile(join(config.tempDir, key)),
      }),
    );
    await pool.query(
      `UPDATE "Upload" SET "leaseUntil" = now() - interval '1 second'
      WHERE id = $1`,
      [upload.id],
    );
    await recoverExpired();
    const state = await store.get(upload.id, userId);
    expect(state.status).toBe('COMPLETED');
    expect(state.attemptCount).toBe(1);
    const resource = await pool.query<{ objectKey: string; sha256: string }>(
      'SELECT "objectKey",sha256 FROM "Resource" WHERE id = $1',
      [upload.resourceId],
    );
    expect(resource.rows[0].objectKey).toBe(job!.objectKey);
    expect(resource.rows[0].sha256).toBe(state.sha256);
    expect(bytes.length).toBe(Number(state.receivedBytes));
    expect(
      (await pool.query('SELECT id FROM "UploadAttempt" WHERE "uploadId" = $1', [upload.id]))
        .rowCount,
    ).toBe(1);
    expect(await processUpload(upload.id)).toBe(true);
  });

  it('reencola tras caída antes de S3 y usa nueva clave en el segundo intento', async () => {
    const { upload, userId } = await queued();
    const first = await acquire(upload.id);
    await pool.query(
      `UPDATE "Upload" SET "leaseUntil" = now() - interval '1 second'
      WHERE id = $1`,
      [upload.id],
    );
    await recoverExpired();
    const retry = await store.get(upload.id, userId);
    expect(retry.status).toBe('QUEUED');
    expect(retry.attemptCount).toBe(1);
    const wake = await pool.query<{ availableAt: Date }>(
      `SELECT "availableAt" FROM "Outbox"
      WHERE "entityId" = $1 AND "publishedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
      [upload.id],
    );
    expect(wake.rows[0].availableAt.getTime()).toBeGreaterThan(Date.now());
    await pool.query(`UPDATE "Upload" SET "nextAttemptAt" = now() WHERE id = $1`, [upload.id]);
    expect(await processUpload(upload.id)).toBe(true);
    const published = await pool.query<{ objectKey: string }>(
      'SELECT "objectKey" FROM "Resource" WHERE id = $1',
      [upload.resourceId],
    );
    expect(published.rows[0].objectKey).not.toBe(first!.objectKey);
    expect((await store.get(upload.id, userId)).attemptCount).toBe(2);
  });

  it('el temporal ausente termina de forma explícita y no reactiva la carga', async () => {
    const { upload, userId } = await queued();
    const first = await acquire(upload.id);
    await rm(join(config.tempDir, (await store.get(upload.id, userId)).tempKey!), { force: true });
    await pool.query(
      `UPDATE "Upload" SET "leaseUntil" = now() - interval '1 second'
      WHERE id = $1`,
      [upload.id],
    );
    await recoverExpired();
    expect((await store.get(upload.id, userId)).status).toBe('FAILED');
    const attempt = await pool.query<{ failureCode: string }>(
      'SELECT "failureCode" FROM "UploadAttempt" WHERE id = $1',
      [first!.attemptId],
    );
    expect(attempt.rows[0].failureCode).toBe('TEMP_MISSING');
    expect(await processUpload(upload.id)).toBe(true);
    await recoverExpired();
    expect((await store.get(upload.id, userId)).status).toBe('FAILED');
  });

  it('tres leases perdidos terminan en FAILED sin cuarto intento', async () => {
    const { upload, userId } = await queued();
    for (let count = 1; count <= 3; count++) {
      const acquired = await acquire(upload.id);
      expect(acquired).not.toBeNull();
      await pool.query(
        `UPDATE "Upload" SET "leaseUntil" = now() - interval '1 second'
        WHERE id = $1`,
        [upload.id],
      );
      await recoverExpired();
      const state = await store.get(upload.id, userId);
      expect(state.attemptCount).toBe(count);
      expect(state.status).toBe(count === 3 ? 'FAILED' : 'QUEUED');
      if (count < 3)
        await pool.query(
          `UPDATE "Upload" SET "nextAttemptAt" = now()
        WHERE id = $1`,
          [upload.id],
        );
    }
    expect(await processUpload(upload.id)).toBe(true);
    expect((await store.get(upload.id, userId)).attemptCount).toBe(3);
  });

  it('cancela durante la espera del reintento sin reactivar ni publicar', async () => {
    const { upload, userId } = await queued();
    await acquire(upload.id);
    await pool.query(
      `UPDATE "Upload" SET "leaseUntil" = now() - interval '1 second'
      WHERE id = $1`,
      [upload.id],
    );
    await recoverExpired();
    expect((await store.get(upload.id, userId)).status).toBe('QUEUED');
    await requestCancellation(upload.id, userId);
    await cleanupCancellation(upload.id);
    expect((await store.get(upload.id, userId)).status).toBe('CANCELLED');
    expect(await processUpload(upload.id)).toBe(true);
    await recoverExpired();
    expect((await store.get(upload.id, userId)).status).toBe('CANCELLED');
    const resource = await pool.query('SELECT id FROM "Resource" WHERE id = $1', [
      upload.resourceId,
    ]);
    expect(resource.rowCount).toBe(0);
  });
});
