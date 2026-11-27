import type { FastifyInstance } from 'fastify';
import {
  DeleteQuery,
  DeletionResponse,
  EditResourceResponse,
  RenameResource,
  ResourceParams,
  type Static,
} from '@drive-clone/contracts';
import { verifyCsrf, verifyOrigin } from '../identity/auth-hooks.ts';
import { getDeletion, requestDeletion } from '../deletions/request.ts';
import { renameResource } from './rename.ts';

type Params = Static<typeof ResourceParams>;

export async function registerEditRoutes(app: FastifyInstance) {
  const mutation = [app.requireAuth, verifyOrigin, verifyCsrf(app)];
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
  });
  app.patch<{ Params: Params; Body: Static<typeof RenameResource> }>(
    '/resources/:id',
    {
      preHandler: mutation,
      schema: {
        params: ResourceParams,
        body: RenameResource,
        response: { 200: EditResourceResponse },
      },
    },
    async (request) => {
      const { id } = request.params;
      const resource = await renameResource(request.user!.id, id, request.body.name);
      request.log.info({ resourceId: id }, 'Recurso renombrado');
      return { resource };
    },
  );
  app.delete<{ Params: Params; Querystring: { confirmRecursive?: string } }>(
    '/resources/:id',
    {
      preValidation: async (request) => {
        if (request.query.confirmRecursive === 'true')
          Object.assign(request.query, { confirmRecursive: true });
      },
      preHandler: mutation,
      schema: {
        params: ResourceParams,
        querystring: DeleteQuery,
        response: { 202: DeletionResponse },
      },
    },
    async (request, reply) => {
      const deletion = await requestDeletion(request.user!.id, request.params.id);
      request.log.info({ deletionId: deletion.id }, 'Eliminación solicitada');
      return reply.code(202).send({ deletion });
    },
  );
  app.get<{ Params: Params }>(
    '/deletions/:id',
    {
      preHandler: app.requireAuth,
      schema: { params: ResourceParams, response: { 200: DeletionResponse } },
    },
    async (request) => ({ deletion: await getDeletion(request.user!.id, request.params.id) }),
  );
}
