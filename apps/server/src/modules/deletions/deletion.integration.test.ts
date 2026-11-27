import { HeadObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { editingSession, storedFile } from '../editing/editing.fixture.ts';
import { cleanupCancellation } from '../uploads/cancel.ts';
import { processDeletion } from './worker.ts';

const suite = process.env.RUN_DELETION_INTEGRATION === 'true' ? describe : describe.skip;

suite('O12 borrado recursivo durable', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  it('autoriza al editor, oculta inmediatamente el árbol y cancela reservas antes de limpiar', async () => {
    const [owner, editor, reader, outsider] = await Promise.all(
      Array.from({ length: 4 }, () => editingSession(app)),
    );
    const folder = (await owner.create(owner.rootId, 'Equipo')).json().resource.id;
    const child = (await owner.create(folder, 'Interior')).json().resource.id;
    const file = await storedFile(owner.id, child);
    const reserve = await owner.reserve(child, 'pendiente.txt');
    expect(reserve.statusCode).toBe(201);
    const upload = reserve.json().upload;
    expect((await owner.share(folder, editor.username, 'EDIT')).statusCode).toBe(200);
    expect((await owner.share(folder, reader.username, 'READ')).statusCode).toBe(200);
    expect((await reader.remove(folder)).statusCode).toBe(403);
    expect((await outsider.remove(folder)).statusCode).toBe(404);
    expect((await owner.remove(owner.rootId)).statusCode).toBe(403);
    expect((await owner.remove(folder, false)).statusCode).toBe(400);
    const removed = await editor.remove(folder);
    expect(removed.statusCode, removed.body).toBe(202);
    const { id } = removed.json().deletion;
    expect(removed.json().deletion).toMatchObject({ status: 'PENDING', affectedResources: 4 });
    expect((await owner.remove(folder)).json().deletion.id).toBe(id);
    expect((await reader.deletion(id)).statusCode).toBe(404);
    expect((await outsider.deletion(id)).statusCode).toBe(404);
    expect((await owner.deletion(id)).statusCode).toBe(200);
    expect((await editor.deletion(id)).statusCode).toBe(200);
    expect((await owner.reserve(child, 'nueva.txt')).statusCode).toBe(404);
    expect((await owner.create(child, 'Nueva')).statusCode).toBe(404);
    expect((await editor.download(file.id)).statusCode).toBe(404);
    expect(
      (await pool.query('SELECT status FROM "Upload" WHERE id = $1', [upload.id])).rows[0].status,
    ).toBe('CANCEL_REQUESTED');
    await processDeletion(id);
    expect((await owner.deletion(id)).json().deletion.status).toBe('PENDING');
    await cleanupCancellation(upload.id);
    await pool.query('UPDATE "Deletion" SET "nextAttemptAt" = now() WHERE id = $1', [id]);
    await processDeletion(id);
    await processDeletion(id);
    expect((await owner.deletion(id)).json().deletion).toMatchObject({
      status: 'COMPLETED',
      processedResources: 4,
    });
    expect((await owner.remove(folder)).statusCode).toBe(404);
    expect((await owner.list(owner.rootId)).json().items).toEqual([]);
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: file.key })),
    ).rejects.toMatchObject({ name: 'NotFound' });
    expect(
      (await pool.query('SELECT "usedBytes","reservedBytes" FROM "User" WHERE id = $1', [owner.id]))
        .rows[0],
    ).toEqual({ usedBytes: '0', reservedBytes: '0' });
  });

  it('rechaza borrados superpuestos y completa el borrado de una carpeta vacía', async () => {
    const owner = await editingSession(app);
    const parent = (await owner.create(owner.rootId, 'Padre')).json().resource.id;
    const child = (await owner.create(parent, 'Vacía')).json().resource.id;
    const response = await owner.remove(child);
    expect(response.statusCode).toBe(202);
    expect((await owner.remove(parent)).statusCode).toBe(409);
    await processDeletion(response.json().deletion.id);
    expect((await owner.list(parent)).json().items).toEqual([]);
  });
});
