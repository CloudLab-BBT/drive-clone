import type { FastifyInstance } from 'fastify';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { PageQuery, ResourcePage, ResourceParams } from '@drive-clone/contracts';
import { pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { AppError, InvalidInputError } from '../identity/errors.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { FileStore } from './store.ts';

function page(query: { cursor?: string; limit?: number }, scope: string) {
  const limit = query.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new InvalidInputError('Límite inválido');
  return { limit, after: decodeCursor(query.cursor, scope) };
}

function attachment(name: string): string {
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\;%]/g, '_').trim() || 'archivo';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (value) =>
    `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function registerFileRoutes(app: FastifyInstance) {
  const store = new FileStore(pool);
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
  });

  app.get('/folders/:id/children', { preHandler: [app.requireAuth], schema: {
    params: ResourceParams, querystring: PageQuery, response: { 200: ResourcePage },
  } }, async (request) => {
    const { id } = request.params as { id: string };
    const scope = `children:${id}`;
    const result = await store.children(request.user!.id, id,
      page(request.query as { cursor?: string; limit?: number }, scope));
    return { items: result.items, nextCursor: encodeCursor(result.next, scope) };
  });

  app.get('/shared', { preHandler: [app.requireAuth], schema: {
    querystring: PageQuery, response: { 200: ResourcePage },
  } }, async (request) => {
    const scope = `shared:${request.user!.id}`;
    const result = await store.shared(request.user!.id,
      page(request.query as { cursor?: string; limit?: number }, scope));
    return { items: result.items, nextCursor: encodeCursor(result.next, scope) };
  });

  app.get('/files/:id/download', { preHandler: [app.requireAuth], schema: {
    params: ResourceParams,
  } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await store.download(request.user!.id, id);
    try {
      const object = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: row.objectKey! }));
      if (!(object.Body instanceof Readable) || object.ContentLength !== Number(row.size)) {
        request.log.error({ resourceId: id }, 'Objeto S3 incompleto');
        throw new AppError('DEPENDENCY_UNAVAILABLE', 'Archivo no disponible temporalmente', 503);
      }
      object.Body.on('error', (error) => request.log.error({ error, resourceId: id }, 'Error de lectura S3'));
      reply.header('Content-Type', row.mimeType!);
      reply.header('Content-Length', Number(row.size));
      reply.header('Content-Disposition', attachment(row.name));
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(object.Body);
    } catch (error) {
      if (error instanceof AppError) throw error;
      request.log.error({ error, resourceId: id }, 'No se pudo leer el objeto S3');
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Archivo no disponible temporalmente', 503);
    }
  });
}
