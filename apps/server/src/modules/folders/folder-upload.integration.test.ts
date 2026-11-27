import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { randomUUID } from 'node:crypto';
import { closeClients, pool } from '../../platform/clients.ts';
import { folderSession } from './folder-session.fixture.ts';

import { complete } from '../uploads/process-finalize.ts';
import type { Job } from '../uploads/process-acquire.ts';
import { markDeleting } from './folder-deletion.fixture.ts';

const workerEnabled = process.env.RUN_UPLOAD_INTEGRATION === 'true';

describe('O08 carga dentro de una carpeta', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  it.skipIf(!workerEnabled)(
    'procesa por cola, lista en el destino y descarga los mismos bytes',
    async () => {
      const owner = await folderSession(app);
      const folder = await owner.create(owner.rootId, 'Destino');
      const parentId = folder.json().resource.id as string;
      const name = 'muestra.txt';
      const content = 'Archivo de prueba';
      const reservation = await owner.reserve(parentId, name, Buffer.byteLength(content));
      expect(reservation.statusCode).toBe(201);
      const { id, resourceId } = reservation.json().upload;
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/uploads/${id}/content`,
        headers: { ...owner.headers, 'content-type': 'multipart/form-data; boundary=o08' },
        payload:
          '--o08\r\nContent-Disposition: form-data; name="file"; filename="muestra.txt"\r\n' +
          'Content-Type: text/plain\r\n\r\n' +
          content +
          '\r\n--o08--\r\n',
      });
      expect(response.statusCode, response.body).toBe(202);
      await expect
        .poll(
          async () => {
            const status = await app.inject({
              url: `/api/v1/uploads/${id}`,
              headers: owner.headers,
            });
            return status.json().upload.status;
          },
          { timeout: 12_000, interval: 200 },
        )
        .toBe('COMPLETED');
      expect((await owner.list(parentId)).json().items).toMatchObject([
        { id: resourceId, parentId, name },
      ]);
      expect((await owner.list(owner.rootId)).json().items).toHaveLength(1);
      const download = await app.inject({
        url: `/api/v1/files/${resourceId}/download`,
        headers: owner.headers,
      });
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload).toEqual(Buffer.from(content));
    },
    16_000,
  );
  it('impide publicar una reserva previa bajo un ancestro en eliminación', async () => {
    const owner = await folderSession(app);
    const ancestor = (await owner.create(owner.rootId, 'Ancestro')).json().resource.id;
    const target = (await owner.create(ancestor, 'Destino')).json().resource.id;
    const reserved = await owner.reserve(target, 'archivo.txt');
    expect(reserved.statusCode).toBe(201);
    const {
      rows: [job],
    } = await pool.query<Job>(
      'SELECT u.*, r.name FROM "Upload" u JOIN "Resource" r ON r.id = u."resourceId" WHERE u.id = $1',
      [reserved.json().upload.id],
    );

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [owner.id]);
      await markDeleting(db, owner.id, ancestor);
      await db.query('COMMIT');
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }

    await expect(complete(job, randomUUID(), 'sin-publicar')).rejects.toMatchObject({
      code: 'RESOURCE_UNAVAILABLE',
    });
    const { rows } = await pool.query('SELECT status,"objectKey" FROM "Resource" WHERE id = $1', [
      job.resourceId,
    ]);
    expect(rows).toEqual([{ status: 'RESERVED', objectKey: null }]);
  });
});
