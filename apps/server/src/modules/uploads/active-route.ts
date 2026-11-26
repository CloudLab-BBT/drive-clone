import { ActiveUploads } from '@drive-clone/contracts';
import type { FastifyInstance } from 'fastify';
import { AppError, InvalidInputError } from '../identity/errors.ts';
import { UploadStore, publicUpload } from './store.ts';

const polls = new Map<string, number>();

export function registerActiveUploadRoute(app: FastifyInstance, store: UploadStore) {
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
    async (request, reply) => {
      if (String((request.query as { active?: string | boolean }).active) !== 'true')
        throw new InvalidInputError('Se requiere active=true');
      const now = Date.now();
      const userId = request.user!.id;
      const previous = polls.get(userId) ?? 0;
      if (now - previous < 1000) {
        reply.header('Retry-After', '1');
        throw new AppError('RATE_LIMITED', 'Consulta de cargas demasiado frecuente', 429);
      }
      if (polls.size > 5000) {
        for (const [id, at] of polls) if (now - at > 60_000) polls.delete(id);
      }
      polls.set(userId, now);
      return { items: (await store.active(userId)).map(publicUpload) };
    },
  );
}
