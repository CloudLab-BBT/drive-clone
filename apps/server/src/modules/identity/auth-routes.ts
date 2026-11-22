import type { FastifyInstance } from 'fastify';
import { authConfig } from '../../platform/auth-config.ts';
import { InvalidInputError, UnauthenticatedError } from './errors.ts';
import type { IdentityService } from './identity-service.ts';
import { verifyCsrf, verifyOrigin } from './auth-hooks.ts';

type RateLimitOption = boolean | {
  login?: { max: number; timeWindow: number };
  register?: { max: number; timeWindow: number };
};

interface AuthBody {
  username?: unknown;
  password?: unknown;
}

export async function registerAuthRoutes(
  fastify: FastifyInstance,
  identityService: IdentityService,
  rateLimit: RateLimitOption | undefined,
): Promise<void> {
  const csrf = verifyCsrf(fastify);
  const custom = typeof rateLimit === 'object';
  const registerLimit = rateLimit === false ? false : custom && rateLimit.register
    ? rateLimit.register : authConfig.rateLimitRegister;
  const loginLimit = rateLimit === false ? false : custom && rateLimit.login
    ? rateLimit.login : authConfig.rateLimitLogin;

  fastify.get('/auth/csrf', {
    schema: { response: { 200: { type: 'object', required: ['csrfToken'], properties: { csrfToken: { type: 'string' } } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const csrfToken = reply.generateCsrf();
    await request.session.save();
    return { csrfToken };
  });

  fastify.post('/auth/register', {
    config: { rateLimit: registerLimit },
    preHandler: [verifyOrigin, csrf],
  }, async (request, reply) => {
    const body = request.body as AuthBody | null;
    if (!body) throw new InvalidInputError('Cuerpo de solicitud requerido');
    const user = await identityService.register({
      username: String(body.username ?? ''),
      password: String(body.password ?? ''),
    });
    await request.session.regenerate();
    request.session.userId = user.id;
    request.session.username = user.username;
    request.session.authCreatedAt = Date.now();
    request.session.lastActivity = Date.now();
    await request.session.save();
    reply.code(201);
    return { user };
  });

  fastify.post('/auth/login', {
    config: { rateLimit: loginLimit },
    preHandler: [verifyOrigin, csrf],
  }, async (request) => {
    const body = request.body as AuthBody | null;
    if (!body) throw new InvalidInputError('Cuerpo de solicitud requerido');
    const user = await identityService.login({
      username: String(body.username ?? ''),
      password: String(body.password ?? ''),
    });
    await request.session.regenerate();
    request.session.userId = user.id;
    request.session.username = user.username;
    request.session.authCreatedAt = Date.now();
    request.session.lastActivity = Date.now();
    await request.session.save();
    return { user };
  });

  fastify.post('/auth/logout', {
    preHandler: [fastify.requireAuth, verifyOrigin, csrf],
  }, async (request, reply) => {
    await request.session.destroy();
    reply.clearCookie(authConfig.sessionCookieName, { path: '/api/v1' });
    reply.code(204);
    return reply.send();
  });

  fastify.get('/auth/me', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (!request.user) throw new UnauthenticatedError('Usuario no encontrado');
    return { user: await identityService.getUser(request.user.id) };
  });
}
