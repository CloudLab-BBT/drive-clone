import type { FastifyInstance } from 'fastify';
import { ActiveUploads, UploadResponse } from '@drive-clone/contracts';
import type { Readable } from 'node:stream';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { verifyCsrf, verifyOrigin } from '../identity/auth-hooks.ts';
import { AppError, InvalidInputError } from '../identity/errors.ts';
import { receiveFile } from './receive.ts';
import { UploadStore, publicUpload } from './store.ts';

const uuid = { type: 'string', format: 'uuid' };
const params = { type: 'object', required: ['id'], properties: { id: uuid } };
const createBody = { type: 'object', additionalProperties: false, required: ['parentId','name','size'],
  properties: { parentId: uuid, name: { type: 'string' }, size: { type: 'integer', minimum: 0 } } };

export async function registerUploadRoutes(app: FastifyInstance) {
  const store = new UploadStore(pool);
  const mutation = [app.requireAuth, verifyOrigin, verifyCsrf(app)];
  app.addContentTypeParser('application/octet-stream', (request, payload, done) => {
    done(null, payload);
  });

  app.post('/uploads', { preHandler: mutation, schema: { body: createBody,
    response: { 201: UploadResponse } } }, async (request, reply) => {
    const input = request.body as { parentId: string; name: string; size: number };
    const row = await store.create(request.user!.id, input);
    reply.code(201);
    return { upload: publicUpload(row) };
  });

  app.put('/uploads/:id/content', { preHandler: mutation, schema: { params,
    response: { 202: UploadResponse } }, bodyLimit: 100 * 1024 * 1024 + 1 },
    async (request, reply) => {
      if (!request.headers['content-type']?.startsWith('application/octet-stream'))
        throw new AppError('FORMAT_INVALID', 'Se requiere application/octet-stream', 415);
      const { id } = request.params as { id: string };
      const userId = request.user!.id;
      await store.get(id, userId);
      const row = await store.start(id, userId);
      const resource = await pool.query<{ name: string }>('SELECT name FROM "Resource" WHERE id = $1', [row.resourceId]);
      try {
        const result = await receiveFile(request.body as Readable, row, resource.rows[0].name);
        try {
          const queued = await store.queue(id, userId, result.tempKey, result.bytes, result.sha256);
          reply.code(202);
          return { upload: publicUpload(queued) };
        } catch (error) {
          await rm(join(config.tempDir, result.tempKey), { force: true });
          throw error;
        }
      } catch (error) {
        const code = error instanceof AppError && error.code === 'FORMAT_INVALID' ? 'FORMAT_INVALID'
          : error instanceof AppError && ['SIZE_MISMATCH', 'FILE_TOO_LARGE'].includes(error.code)
            ? 'SIZE_MISMATCH' : 'RECEIVE_INTERRUPTED';
        await store.fail(id, code);
        throw error;
      }
    });

  app.get('/uploads', { preHandler: [app.requireAuth], schema: { response: { 200: ActiveUploads }, querystring: {
    type: 'object', additionalProperties: false, required: ['active'], properties: { active: { const: 'true' } },
  } } }, async (request) => {
    if (String((request.query as { active?: string | boolean }).active) !== 'true')
      throw new InvalidInputError('Se requiere active=true');
    return { items: (await store.active(request.user!.id)).map(publicUpload) };
  });

  app.get('/uploads/:id', { preHandler: [app.requireAuth], schema: { params,
    response: { 200: UploadResponse } } }, async (request) => {
    const { id } = request.params as { id: string };
    return { upload: publicUpload(await store.get(id, request.user!.id)) };
  });
}
