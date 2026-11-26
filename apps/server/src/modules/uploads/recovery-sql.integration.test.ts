import { randomUUID } from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { processUpload } from './process.ts';
import { queued, store } from './recovery-fixture.ts';

const suite = process.env.RUN_O13_INTEGRATION === 'true' ? describe : describe.skip;
suite('fallo SQL posterior a S3', () => {
  afterAll(async () => {
    await closeClients();
  });

  it('descarta el objeto no confirmado y completa con una clave nueva', async () => {
    const { upload, userId } = await queued();
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `o13_fail_${suffix}`;
    const triggerName = `o13_trigger_${suffix}`;
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = '${upload.resourceId}' AND NEW.status = 'ACTIVE' THEN
        RAISE EXCEPTION 'confirmación SQL interrumpida'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${triggerName} BEFORE UPDATE OF status ON "Resource"
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      expect(await processUpload(upload.id)).toBe(false);
    } finally {
      await pool.query(`DROP TRIGGER ${triggerName} ON "Resource"`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
    }
    const retry = await store.get(upload.id, userId);
    expect(retry.status).toBe('QUEUED');
    expect(retry.attemptCount).toBe(1);
    const first = await pool.query<{ objectKey: string; status: string }>(
      'SELECT "objectKey",status FROM "UploadAttempt" WHERE "uploadId" = $1',
      [upload.id],
    );
    expect(first.rows[0].status).toBe('CLEANED');
    await expect(
      s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: first.rows[0].objectKey })),
    ).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    });
    await pool.query('UPDATE "Upload" SET "nextAttemptAt" = now() WHERE id = $1', [upload.id]);
    expect(await processUpload(upload.id)).toBe(true);
    const resource = await pool.query<{ objectKey: string }>(
      'SELECT "objectKey" FROM "Resource" WHERE id = $1',
      [upload.resourceId],
    );
    expect(resource.rows[0].objectKey).not.toBe(first.rows[0].objectKey);
    expect((await store.get(upload.id, userId)).attemptCount).toBe(2);
  });
});
