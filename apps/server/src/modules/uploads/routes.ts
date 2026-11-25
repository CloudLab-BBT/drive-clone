import type { FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { ActiveUploads, UploadResponse } from '@drive-clone/contracts';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { verifyCsrf, verifyOrigin } from '../identity/auth-hooks.ts';
import { AppError, InvalidInputError } from '../identity/errors.ts';
import { receiveFile } from './receive.ts';
import { MAX_FILE_BYTES } from './validation.ts';
import { UploadStore, publicUpload } from './store.ts';
import { cleanupCancellation, cleanupFailed, requestCancellation } from './cancel.ts';

const uuid = { type: 'string', format: 'uuid' };
const params = { type: 'object', required: ['id'], properties: { id: uuid } };
const createBody = {
  type: 'object',
  additionalProperties: false,
  required: ['parentId', 'name', 'size'],
  properties: { parentId: uuid, name: { type: 'string' }, size: { type: 'integer', minimum: 0 } },
};

export async function registerUploadRoutes(app: FastifyInstance) {
  await app.register(fastifyMultipart, { attachFieldsToBody: false });
  const store = new UploadStore(pool);
  const mutation = [app.requireAuth, verifyOrigin, verifyCsrf(app)];

  app.post(
    '/uploads',
    { preHandler: mutation, schema: { body: createBody, response: { 201: UploadResponse } } },
    async (request, reply) => {
      const input = request.body as { parentId: string; name: string; size: number };
      const row = await store.create(request.user!.id, input);
      reply.code(201);
      return { upload: publicUpload(row) };
    },
  );

  app.put(
    '/uploads/:id/content',
    {
      preHandler: mutation,
      schema: { params, response: { 202: UploadResponse } },
      bodyLimit: MAX_FILE_BYTES + 1024 * 1024,
    },
    async (request, reply) => {
      if (!request.isMultipart())
        throw new AppError('UNSUPPORTED_FORMAT', 'Se requiere multipart/form-data', 415);
      const { id } = request.params as { id: string };
      const userId = request.user!.id;
      await store.get(id, userId);
      const parts = request.parts({
        limits: { files: 2, fields: 1, parts: 2, fileSize: MAX_FILE_BYTES + 1 },
      });
      const first = await parts.next();
      if (first.done || first.value.type !== 'file' || first.value.fieldname !== 'file')
        throw new InvalidInputError('Se requiere exactamente un campo file');
      const row = await store.start(id, userId);
      const resource = await pool.query<{ name: string }>(
        'SELECT name FROM "Resource" WHERE id = $1',
        [row.resourceId],
      );
      try {
        const result = await receiveFile(
          first.value.file,
          row,
          resource.rows[0].name,
          async () => (await store.get(id, userId)).status === 'CANCEL_REQUESTED',
        );
        try {
          const extra = await parts.next();
          if (!extra.done) throw new InvalidInputError('Se requiere exactamente un campo file');
          const queued = await store.queue(id, userId, result.tempKey, result.bytes, result.sha256);
          reply.code(202);
          return { upload: publicUpload(queued) };
        } catch (error) {
          await rm(join(config.tempDir, result.tempKey), { force: true });
          throw error;
        }
      } catch (error) {
        const multipartCode = (error as { code?: string }).code;
        const code =
          error instanceof AppError && error.code === 'UNSUPPORTED_FORMAT'
            ? 'FORMAT_INVALID'
            : error instanceof AppError &&
                ['INVALID_INPUT', 'PAYLOAD_TOO_LARGE'].includes(error.code)
              ? 'SIZE_MISMATCH'
              : 'RECEIVE_INTERRUPTED';
        await store.fail(id, code);
        await cleanupCancellation(id, true);
        await cleanupFailed(id);
        if (multipartCode === 'FST_REQ_FILE_TOO_LARGE')
          throw new AppError('PAYLOAD_TOO_LARGE', 'Archivo demasiado grande', 413);
        if (
          ['FST_PARTS_LIMIT', 'FST_FILES_LIMIT', 'FST_FIELDS_LIMIT'].includes(multipartCode ?? '')
        )
          throw new InvalidInputError('Se requiere exactamente un campo file');
        throw error;
      }
    },
  );

  app.post(
    '/uploads/:id/cancel',
    { preHandler: mutation, schema: { params, response: { 200: UploadResponse } } },
    async (request) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.id;
      await requestCancellation(id, userId);
      await cleanupCancellation(id);
      return { upload: publicUpload(await store.get(id, userId)) };
    },
  );

  app.get(
    '/uploads',
    {
      preHandler: [app.requireAuth],
      schema: {
        response: { 200: ActiveUploads },
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['active'],
          properties: { active: { const: 'true' } },
        },
      },
    },
    async (request) => {
      if (String((request.query as { active?: string | boolean }).active) !== 'true')
        throw new InvalidInputError('Se requiere active=true');
      return { items: (await store.active(request.user!.id)).map(publicUpload) };
    },
  );

  app.get(
    '/uploads/:id',
    { preHandler: [app.requireAuth], schema: { params, response: { 200: UploadResponse } } },
    async (request) => {
      const { id } = request.params as { id: string };
      return { upload: publicUpload(await store.get(id, request.user!.id)) };
    },
  );
}
