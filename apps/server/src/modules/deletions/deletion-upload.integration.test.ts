import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { editingSession } from '../editing/editing.fixture.ts';
import { cleanupCancellation } from '../uploads/cancel.ts';
import { acquire } from '../uploads/process-acquire.ts';
import { complete } from '../uploads/process-finalize.ts';
import { processDeletion } from './worker.ts';

const suite = process.env.RUN_DELETION_INTEGRATION === 'true' ? describe : describe.skip;

suite('O12 carrera con la publicación de una carga', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  it('invalida la publicación de un intento activo y conserva su objeto hasta la limpieza', async () => {
    const owner = await editingSession(app);
    const folder = (await owner.create(owner.rootId, 'Destino')).json().resource.id;
    const data = 'Datos de prueba';
    const reserved = await owner.reserve(folder, 'carga.txt', Buffer.byteLength(data));
    const upload = reserved.json().upload;
    const received = await app.inject({
      method: 'PUT',
      url: `/api/v1/uploads/${upload.id}/content`,
      headers: { ...owner.headers, 'content-type': 'multipart/form-data; boundary=o12' },
      payload:
        '--o12\r\nContent-Disposition: form-data; name="file"; filename="carga.txt"\r\n' +
        'Content-Type: text/plain\r\n\r\n' +
        data +
        '\r\n--o12--\r\n',
    });
    expect(received.statusCode).toBe(202);
    const attempt = await acquire(upload.id);
    expect(attempt).not.toBeNull();
    const work = attempt!;
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: work.objectKey, Body: data }));

    const removed = await owner.remove(folder);
    expect(removed.statusCode).toBe(202);
    const { id } = removed.json().deletion;
    expect(await complete(work.job, work.attemptId, work.objectKey)).toBe(false);
    await processDeletion(id);
    expect((await owner.deletion(id)).json().deletion.status).toBe('PENDING');

    await pool.query('UPDATE "Upload" SET "leaseUntil" = now() WHERE id = $1', [upload.id]);
    await cleanupCancellation(upload.id);
    await pool.query('UPDATE "Deletion" SET "nextAttemptAt" = now() WHERE id = $1', [id]);
    await processDeletion(id);
    expect((await owner.deletion(id)).json().deletion).toMatchObject({
      status: 'COMPLETED',
      processedResources: 2,
    });
    expect((await owner.download(upload.resourceId)).statusCode).toBe(404);
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: work.objectKey })),
    ).rejects.toMatchObject({ name: 'NotFound' });
  });
});
