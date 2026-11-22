import type { ResourceAuthorization } from '@drive-clone/contracts';
import type { FastifyRequest } from 'fastify';
import { AppError, UnauthenticatedError } from '../identity/errors.ts';
import type { Input } from './policy.ts';

export function requireResourceAccess(authorization: ResourceAuthorization) {
  return async (
    request: Pick<FastifyRequest, 'user'>, resourceId: string, action: Input['action'],
  ) => {
    const actorId = request.user?.id;
    if (!actorId) throw new UnauthenticatedError();
    const decision = await authorization.evaluate({ actorId, resourceId, action });
    if (!decision.visible) {
      throw new AppError('RESOURCE_UNAVAILABLE', 'Recurso no disponible', 404);
    }
    if (!decision.allowed) {
      throw new AppError('FORBIDDEN', 'Acción no permitida', 403);
    }
    return decision;
  };
}
