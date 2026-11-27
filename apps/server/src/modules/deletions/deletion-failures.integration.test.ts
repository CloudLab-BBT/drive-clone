import { HeadObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.ts';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { editingSession, storedFile } from '../editing/editing.fixture.ts';
import { acquireDeletion, resumeFailedDeletion, wakeDeletions } from './jobs.ts';
import { processDeletion } from './worker.ts';

const suite = process.env.RUN_DELETION_INTEGRATION === 'true' ? describe : describe.skip;

suite('O12 fallos parciales y recuperación', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  it('conserva el inventario al fallar S3 tres veces y permite restaurar el proceso', async () => {
    const owner = await editingSession(app);
    const file = await storedFile(owner.id, owner.rootId);
    const response = await owner.remove(file.id);
    expect(response.statusCode).toBe(202);
    const { id } = response.json().deletion;
    const send = vi.spyOn(s3, 'send');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        send.mockRejectedValueOnce(new Error('Fallo de almacenamiento de prueba'));
        await processDeletion(id);
        expect((await owner.deletion(id)).json().deletion).toMatchObject({
          status: attempt < 2 ? 'PENDING' : 'FAILED',
          processedResources: 0,
        });
        if (attempt < 2)
          await pool.query('UPDATE "Deletion" SET "nextAttemptAt" = now() WHERE id = $1', [id]);
      }
    } finally {
      send.mockRestore();
    }
    expect((await owner.deletion(id)).json().deletion.errorCode).toBe('CLEANUP_FAILED');
    expect((await owner.download(file.id)).statusCode).toBe(404);
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: file.key })),
    ).resolves.toBeDefined();
    expect(await resumeFailedDeletion(id)).toBe(true);
    expect(await resumeFailedDeletion(id)).toBe(false);
    await processDeletion(id);
    expect((await owner.deletion(id)).json().deletion.status).toBe('COMPLETED');
  });

  it('reintenta después de borrar S3 si PostgreSQL revierte la eliminación de metadatos', async () => {
    const owner = await editingSession(app);
    const file = await storedFile(owner.id, owner.rootId);
    const response = await owner.remove(file.id);
    const { id } = response.json().deletion;
    await pool.query('UPDATE "User" SET "usedBytes" = 0 WHERE id = $1', [owner.id]);
    await processDeletion(id);
    expect((await owner.deletion(id)).json().deletion).toMatchObject({
      status: 'PENDING',
      processedResources: 0,
    });
    expect(
      (await pool.query('SELECT status FROM "Resource" WHERE id = $1', [file.id])).rows[0].status,
    ).toBe('DELETING');
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: file.key })),
    ).rejects.toMatchObject({ name: 'NotFound' });
    await pool.query('UPDATE "User" SET "usedBytes" = $2 WHERE id = $1', [
      owner.id,
      file.bytes.length,
    ]);
    await pool.query('UPDATE "Deletion" SET "nextAttemptAt" = now() WHERE id = $1', [id]);
    await processDeletion(id);
    expect((await owner.deletion(id)).json().deletion).toMatchObject({
      status: 'COMPLETED',
      processedResources: 1,
    });
  });
  it('recupera un lease y un mensaje perdidos sin duplicar progreso', async () => {
    const owner = await editingSession(app);
    const folder = (await owner.create(owner.rootId, 'Pendiente')).json().resource.id;
    const { id } = (await owner.remove(folder)).json().deletion;
    const first = await acquireDeletion(id);
    expect(first).not.toBeNull();
    expect(await acquireDeletion(id)).toBeNull();
    await pool.query(
      `UPDATE "Deletion" SET "leaseUntil" = now() - interval '1 second' WHERE id = $1`,
      [id],
    );
    await pool.query(
      `UPDATE "Outbox" SET "publishedAt" = now() - interval '61 seconds'
       WHERE type = 'DELETE' AND "entityId" = $1`,
      [id],
    );
    await wakeDeletions();
    const outbox = await pool.query(
      `SELECT "publishedAt" FROM "Outbox" WHERE type = 'DELETE' AND "entityId" = $1`,
      [id],
    );
    expect(outbox.rows).toEqual([{ publishedAt: null }]);
    await Promise.all([processDeletion(id), processDeletion(id)]);
    expect((await owner.deletion(id)).json().deletion).toMatchObject({
      status: 'COMPLETED',
      processedResources: 1,
    });
    const job = await pool.query('SELECT "attemptCount" FROM "Deletion" WHERE id = $1', [id]);
    expect(job.rows).toEqual([{ attemptCount: 2 }]);
  });
});
