import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { authConfig } from '../../platform/auth-config.ts';
import { IdentityService } from './identity-service.ts';
import {
  CsrfInvalidError,
  ForbiddenError,
  InvalidInputError,
  UnauthenticatedError,
} from './errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; username: string };
  }
}

export interface AuthPluginOptions {
  identityService: IdentityService;
  rateLimit?: boolean | {
    login?: { max: number; timeWindow: number };
    register?: { max: number; timeWindow: number };
  };
}

export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  const { identityService, rateLimit } = opts;

  // Lista blanca de orígenes permitidos
  const allowedOrigins = authConfig.corsOrigin
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  /**
   * Hook para verificar la cabecera Origin en todas las mutaciones de estado.
   */
  const verifyOrigin = async (request: FastifyRequest, _reply: FastifyReply) => {
    const method = request.method.toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const rawOrigin = request.headers.origin || request.headers.referer;
      if (!rawOrigin) {
        throw new CsrfInvalidError('Cabecera Origin requerida para operaciones de modificación');
      }

      // Extraer origen base (protocolo + host) si viene referer
      let requestOrigin = rawOrigin;
      try {
        const parsed = new URL(rawOrigin);
        requestOrigin = parsed.origin;
      } catch {
        throw new CsrfInvalidError('Cabecera Origin con formato inválido');
      }

      const matches = allowedOrigins.some((allowed) => allowed === requestOrigin);
      if (!matches) {
        throw new CsrfInvalidError(`Origen no permitido: ${requestOrigin}`);
      }
    }
  };

  /**
   * Hook para proteger endpoints privados.
   * Verifica sesión activa, no expirada (absoluta 8h / inactividad 30m) y no revocada.
   */
  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = request.session;
    const userId = (session as any)?.userId as string | undefined;

    if (!session || !userId) {
      throw new UnauthenticatedError('Sesión no autenticada');
    }

    const now = Date.now();
    const authCreatedAt = Number((session as any).authCreatedAt ?? 0);
    const lastActivity = Number((session as any).lastActivity ?? 0);

    // 1. Expiración absoluta: 8 horas máximo desde creación de la sesión autenticada
    if (authCreatedAt > 0 && now - authCreatedAt > authConfig.sessionAbsoluteMaxAge) {
      await session.destroy();
      reply.clearCookie(authConfig.sessionCookieName, { path: '/api/v1' });
      throw new UnauthenticatedError('Sesión expirada por límite absoluto de 8 horas');
    }

    // 2. Expiración por inactividad: 30 minutos máximo sin actividad
    if (lastActivity > 0 && now - lastActivity > authConfig.sessionIdleTimeout) {
      await session.destroy();
      reply.clearCookie(authConfig.sessionCookieName, { path: '/api/v1' });
      throw new UnauthenticatedError('Sesión expirada por inactividad');
    }

    // 3. Verificar que el usuario existe en BD
    const user = await identityService.getUser(userId);
    if (!user) {
      await session.destroy();
      reply.clearCookie(authConfig.sessionCookieName, { path: '/api/v1' });
      throw new UnauthenticatedError('Usuario inexistente o revocado');
    }

    // Actualizar marca de última actividad en sesión
    (session as any).lastActivity = now;
    request.user = { id: user.id, username: user.username };
  };

  /**
   * Helper para invocar csrfProtection como promesa
   */
  const verifyCsrf = async (request: FastifyRequest, reply: FastifyReply) => {
    return new Promise<void>((resolve, reject) => {
      fastify.csrfProtection(request, reply, (err?: any) => {
        if (err) {
          reject(new CsrfInvalidError('Token CSRF inválido o ausente'));
        } else {
          resolve();
        }
      });
    });
  };

  // Configuración de rate limits para rutas
  const isCustomRateLimit = typeof rateLimit === 'object';
  const registerRateLimit = rateLimit === false
    ? false
    : (isCustomRateLimit && rateLimit?.register)
      ? rateLimit.register
      : { max: authConfig.rateLimitRegister.max, timeWindow: authConfig.rateLimitRegister.timeWindow };

  const loginRateLimit = rateLimit === false
    ? false
    : (isCustomRateLimit && rateLimit?.login)
      ? rateLimit.login
      : { max: authConfig.rateLimitLogin.max, timeWindow: authConfig.rateLimitLogin.timeWindow };

  // --- Endpoints de Autenticación y Sesiones ---

  /**
   * GET /api/v1/auth/csrf
   * Inicializa la sesión previa si no existe y genera el token CSRF vinculado a la misma.
   */
  fastify.get('/auth/csrf', {
    schema: {
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['csrfToken'],
          properties: { csrfToken: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const csrfToken = reply.generateCsrf();
    await request.session.save();
    return { csrfToken };
  });

  /**
   * POST /api/v1/auth/register
   * Registro atómico de usuario + raíz protegida con regeneración de sesión y mitigación de fuerza bruta.
   */
  fastify.post('/auth/register', {
    config: {
      rateLimit: registerRateLimit,
    },
    preHandler: async (request, reply) => {
      await verifyOrigin(request, reply);
      await verifyCsrf(request, reply);
    },
  }, async (request, reply) => {
    const body = request.body as any;
    if (!body || typeof body !== 'object') {
      throw new InvalidInputError('Cuerpo de solicitud requerido');
    }

    const user = await identityService.register({
      username: body.username,
      password: body.password,
    });

    // Regenerar ID de sesión para prevenir Session Fixation
    await request.session.regenerate();

    // Guardar identidad en la nueva sesión
    (request.session as any).userId = user.id;
    (request.session as any).username = user.username;
    (request.session as any).authCreatedAt = Date.now();
    (request.session as any).lastActivity = Date.now();
    await request.session.save();

    reply.code(201);
    return { user };
  });

  /**
   * POST /api/v1/auth/login
   * Inicio de sesión con Argon2id, regeneración de sesión y rate limiting.
   */
  fastify.post('/auth/login', {
    config: {
      rateLimit: loginRateLimit,
    },
    preHandler: async (request, reply) => {
      await verifyOrigin(request, reply);
      await verifyCsrf(request, reply);
    },
  }, async (request, reply) => {
    const body = request.body as any;
    if (!body || typeof body !== 'object') {
      throw new InvalidInputError('Cuerpo de solicitud requerido');
    }

    const user = await identityService.login({
      username: body.username,
      password: body.password,
    });

    // Regenerar ID de sesión para prevenir Session Fixation
    await request.session.regenerate();

    // Guardar identidad en la nueva sesión
    (request.session as any).userId = user.id;
    (request.session as any).username = user.username;
    (request.session as any).authCreatedAt = Date.now();
    (request.session as any).lastActivity = Date.now();
    await request.session.save();

    return { user };
  });

  /**
   * POST /api/v1/auth/logout
   * Destruye la sesión en PostgreSQL y limpia la cookie en el cliente.
   */
  fastify.post('/auth/logout', {
    preHandler: async (request, reply) => {
      await requireAuth(request, reply);
      await verifyOrigin(request, reply);
      await verifyCsrf(request, reply);
    },
  }, async (request, reply) => {
    await request.session.destroy();
    reply.clearCookie(authConfig.sessionCookieName, {
      path: '/api/v1',
      httpOnly: true,
      sameSite: 'lax',
      secure: authConfig.cookieSecure,
    });
    reply.code(204);
    return reply.send();
  });

  /**
   * GET /api/v1/auth/me
   * Retorna los datos del usuario autenticado actual y su raíz protegida.
   */
  fastify.get('/auth/me', {
    preHandler: async (request, reply) => {
      await requireAuth(request, reply);
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = (request.session as any).userId as string;
    const user = await identityService.getUser(userId);
    if (!user) {
      throw new UnauthenticatedError('Usuario no encontrado');
    }
    return { user };
  });

  // Exportar hooks para uso en otros módulos (e.g. recursos protegidos O05)
  fastify.decorate('requireAuth', requireAuth);
  fastify.decorate('verifyOrigin', verifyOrigin);
  fastify.decorate('identityService', identityService);
};
