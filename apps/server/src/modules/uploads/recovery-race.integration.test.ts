import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { processUpload } from './process.ts';
import { recoverExpired } from './recovery.ts';
import { queued, store } from './recovery-fixture.ts';

const suite = process.env.RUN_O13_INTEGRATION === 'true' ? describe : describe.skip;
suite('fencing de consumidores', () => {
  afterAll(async () => {
    await closeClients();
  });

  it('dos consumidores no crean intentos ni archivos lógicos duplicados', async () => {
    const { upload, userId } = await queued();
    const results = await Promise.all([processUpload(upload.id), processUpload(upload.id)]);
    expect(results).toContain(true);
    const state = await store.get(upload.id, userId);
    expect(state.status).toBe('COMPLETED');
    expect(state.attemptCount).toBe(1);
    const attempts = await pool.query('SELECT id FROM "UploadAttempt" WHERE "uploadId" = $1', [
      upload.id,
    ]);
    expect(attempts.rowCount).toBe(1);
    const resource = await pool.query('SELECT id FROM "Resource" WHERE id = $1 AND status = $2', [
      upload.resourceId,
      'ACTIVE',
    ]);
    expect(resource.rowCount).toBe(1);
    expect(await processUpload(upload.id)).toBe(true);
    expect((await store.get(upload.id, userId)).attemptCount).toBe(1);
  });

  it('el consumidor antiguo no publica ni sobrescribe el segundo intento', async () => {
    const { upload, userId, bytes } = await queued();
    const original = s3.send.bind(s3);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let oldKey = '';
    const spy = vi.spyOn(s3, 'send').mockImplementation((async (command: unknown) => {
      if (command instanceof PutObjectCommand && !oldKey) {
        oldKey = command.input.Key!;
        await hold;
      }
      return original(command as never);
    }) as typeof s3.send);
    try {
      const old = processUpload(upload.id);
      await vi.waitFor(() => expect(oldKey).not.toBe(''));
      await pool.query(
        `UPDATE "Upload" SET "leaseUntil" = now() - interval '1 second'
        WHERE id = $1`,
        [upload.id],
      );
      await recoverExpired();
      await pool.query('UPDATE "Upload" SET "nextAttemptAt" = now() WHERE id = $1', [upload.id]);
      expect(await processUpload(upload.id)).toBe(true);
      release();
      expect(await old).toBe(false);
      const state = await store.get(upload.id, userId);
      expect(state.status).toBe('COMPLETED');
      expect(state.attemptCount).toBe(2);
      const resource = await pool.query<{ objectKey: string }>(
        'SELECT "objectKey" FROM "Resource" WHERE id = $1',
        [upload.resourceId],
      );
      expect(resource.rows[0].objectKey).not.toBe(oldKey);
      const current = await s3.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: resource.rows[0].objectKey }),
      );
      expect(Buffer.from(await current.Body!.transformToByteArray())).toEqual(bytes);
      await expect(
        s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: oldKey })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    } finally {
      release();
      spy.mockRestore();
    }
  }, 30_000);
});
