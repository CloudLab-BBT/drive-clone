import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { acquire } from './process-acquire.ts';
import { complete } from './process-finalize.ts';
import { cleanupCompleted } from './attempts.ts';
import { verifyPublishedObjects } from './published-audit.ts';
import { queued, store } from './recovery-fixture.ts';

const suite = process.env.RUN_O13_INTEGRATION === 'true' ? describe : describe.skip;
suite('revisión O13: finalización y objetos publicados', () => {
  afterAll(async () => closeClients());

  it('recupera el temporal si cae tras confirmar COMPLETED', async () => {
    const { upload, userId, key } = await queued();
    const acquired = (await acquire(upload.id))!;
    expect(await complete(acquired.job, acquired.attemptId, acquired.objectKey)).toBe(true);
    expect((await store.get(upload.id, userId)).cleanupPending).toBe(true);
    await access(join(config.tempDir, key));
    await cleanupCompleted(upload.id);
    expect((await store.get(upload.id, userId)).cleanupPending).toBe(false);
    await expect(access(join(config.tempDir, key))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rechaza al consumidor que esperó un bloqueo hasta vencer el lease', async () => {
    const { upload, userId } = await queued();
    const acquired = (await acquire(upload.id))!;
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM "Resource" WHERE id = $1 FOR UPDATE', [
        upload.resourceId,
      ]);
      await pool.query(
        `UPDATE "Upload" SET "leaseUntil" = clock_timestamp() + interval '1 second'
         WHERE id = $1`,
        [upload.id],
      );
      const finishing = complete(acquired.job, acquired.attemptId, acquired.objectKey);
      let blocked = false;
      for (let i = 0; i < 40; i++) {
        const waiting = await pool.query<{ blocked: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND query LIKE '%"parentId",status%') AS blocked`,
        );
        if (waiting.rows[0].blocked) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await blocker.query('COMMIT');
      expect(await finishing).toBe(false);
      expect((await store.get(upload.id, userId)).status).toBe('PROCESSING');
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
  });

  it('marca UNAVAILABLE y alerta cuando falta el objeto confirmado', async () => {
    const { upload } = await queued();
    const acquired = (await acquire(upload.id))!;
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: acquired.objectKey,
        Body: 'publicado',
      }),
    );
    expect(await complete(acquired.job, acquired.attemptId, acquired.objectKey)).toBe(true);
    await rm(join(config.tempDir, acquired.job.tempKey!), { force: true });
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: acquired.objectKey }));
    const alerts: string[] = [];
    await verifyPublishedObjects((id) => alerts.push(id));
    const resource = await pool.query<{ status: string }>(
      'SELECT status FROM "Resource" WHERE id = $1',
      [upload.resourceId],
    );
    expect(resource.rows[0].status).toBe('UNAVAILABLE');
    expect(alerts).toContain(upload.resourceId);
  });
});
