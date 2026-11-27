import { CreateFolder, ResourceResponse, type Static } from '@drive-clone/contracts';
import type { FastifyInstance } from 'fastify';
import { pool } from '../../platform/clients.ts';
import { verifyCsrf, verifyOrigin } from '../identity/auth-hooks.ts';
import { normalizeResourceName } from '../resources/name.ts';
import { FolderStore } from './store.ts';

export async function registerFolderRoutes(app: FastifyInstance) {
  const store = new FolderStore(pool);
  app.post<{ Body: Static<typeof CreateFolder> }>(
    '/folders',
    {
      preHandler: [app.requireAuth, verifyOrigin, verifyCsrf(app)],
      schema: { body: CreateFolder, response: { 201: ResourceResponse } },
    },
    async (request, reply) => {
      const { name, nameKey } = normalizeResourceName(request.body.name);
      const row = await store.create(request.user!.id, request.body.parentId, name, nameKey);
      return reply
        .header('Cache-Control', 'private, no-store')
        .code(201)
        .send({
          resource: {
            ...row,
            kind: 'FOLDER',
            isRoot: false,
            effectivePermission: 'OWNER',
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
        });
    },
  );
}
