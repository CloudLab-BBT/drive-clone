import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authConfig } from '../../platform/auth-config.ts';
import { CsrfInvalidError, UnauthenticatedError } from './errors.ts';
import type { IdentityService } from './identity-service.ts';

export async function verifyOrigin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
  const rawOrigin = request.headers.origin ?? request.headers.referer;
  if (!rawOrigin) throw new CsrfInvalidError('Cabecera Origin requerida para operaciones de modificación');

  let requestOrigin: string;
  try {
    requestOrigin = new URL(rawOrigin).origin;
  } catch {
    throw new CsrfInvalidError('Cabecera Origin con formato inválido');
  }
  const allowed = authConfig.corsOrigin.split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean);
  if (!allowed.includes(requestOrigin)) {
    throw new CsrfInvalidError(`Origen no permitido: ${requestOrigin}`);
  }
}

export function verifyCsrf(fastify: FastifyInstance): (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void> {
  return async (request, reply) => {
    await new Promise<void>((resolve, reject) => {
      fastify.csrfProtection(request, reply, (error?: unknown) => {
        if (error) reject(new CsrfInvalidError('Token CSRF inválido o ausente'));
        else resolve();
      });
    });
  };
}

export function createRequireAuth(identityService: IdentityService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const session = request.session;
    const userId = session?.userId;
    if (!session || !userId) throw new UnauthenticatedError('Sesión no autenticada');

    const now = Date.now();
    if (session.authCreatedAt && now - session.authCreatedAt > authConfig.sessionAbsoluteMaxAge) {
      await session.destroy();
      reply.clearCookie(authConfig.sessionCookieName, { path: '/api/v1' });
      throw new UnauthenticatedError('Sesión expirada por límite absoluto de 8 horas');
    }
    if (session.lastActivity && now - session.lastActivity > authConfig.sessionIdleTimeout) {
      await session.destroy();
      reply.clearCookie(authConfig.sessionCookieName, { path: '/api/v1' });
      throw new UnauthenticatedError('Sesión expirada por inactividad');
    }
    const user = await identityService.getUser(userId);
    if (!user) {
      await session.destroy();
      reply.clearCookie(authConfig.sessionCookieName, { path: '/api/v1' });
      throw new UnauthenticatedError('Usuario inexistente o revocado');
    }
    session.lastActivity = now;
    request.user = { id: user.id, username: user.username };
  };
}
