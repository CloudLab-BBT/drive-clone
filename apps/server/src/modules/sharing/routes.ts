import type { FastifyInstance } from 'fastify';
import {
  PageQuery,
  ResourceParams,
  RevokeResponse,
  ShareInput,
  SharePage,
  ShareParams,
  ShareResponse,
  type Static,
} from '@drive-clone/contracts';
import { pool } from '../../platform/clients.ts';
import { verifyCsrf, verifyOrigin } from '../identity/auth-hooks.ts';
import { decodeCursor, encodeCursor } from '../files/cursor.ts';
import { ShareStore } from './store.ts';

export async function registerShareRoutes(app: FastifyInstance) {
  const store = new ShareStore(pool);
  const mutation = [app.requireAuth, verifyOrigin, verifyCsrf(app)];
  const path = '/resources/:id/shares';
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
  });

  app.get<{ Params: Static<typeof ResourceParams>; Querystring: Static<typeof PageQuery> }>(
    path,
    {
      preHandler: app.requireAuth,
      schema: { params: ResourceParams, querystring: PageQuery, response: { 200: SharePage } },
    },
    async (request) => {
      const scope = `shares:${request.params.id}`;
      const { limit, cursor } = request.query;
      const { items, next } = await store.list(request.user!.id, request.params.id, {
        limit,
        after: decodeCursor(cursor, scope),
      });
      return { items, nextCursor: encodeCursor(next, scope) };
    },
  );

  app.put<{ Params: Static<typeof ResourceParams>; Body: Static<typeof ShareInput> }>(
    path,
    {
      preValidation: async (request) => {
        if (typeof request.body?.username === 'string') {
          request.body.username = request.body.username.trim();
        }
      },
      preHandler: mutation,
      schema: { params: ResourceParams, body: ShareInput, response: { 200: ShareResponse } },
    },
    async (request) => {
      const { username, permission } = request.body;
      const share = await store.upsert(request.user!.id, request.params.id, username, permission);
      request.log.info({ resourceId: request.params.id }, 'Concesión actualizada');
      return { share };
    },
  );

  app.delete<{ Params: Static<typeof ShareParams> }>(
    `${path}/:userId`,
    {
      preHandler: mutation,
      schema: { params: ShareParams, response: { 200: RevokeResponse } },
    },
    async (request) => {
      const { id, userId } = request.params;
      const result = await store.revoke(request.user!.id, id, userId);
      request.log.info({ resourceId: id }, 'Concesión revocada');
      return result;
    },
  );
}
