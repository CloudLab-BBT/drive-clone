import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifySession from '@fastify/session';
import fastifyCsrfProtection from '@fastify/csrf-protection';
import fastifyRateLimit from '@fastify/rate-limit';
import { pool } from './platform/clients.ts';
import { readiness } from './platform/health.ts';
import { authConfig, requireAuthConfig } from './platform/auth-config.ts';
import { PgSessionStore } from './modules/identity/session-store.ts';
import { IdentityService } from './modules/identity/identity-service.ts';
import { authPlugin } from './modules/identity/auth-plugin.ts';
import { AppError } from './modules/identity/errors.ts';

export interface BuildAppOptions {
  sessionStore?: any;
  identityService?: IdentityService;
  rateLimit?: boolean | {
    login?: { max: number; timeWindow: number };
    register?: { max: number; timeWindow: number };
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  requireAuthConfig();

  const app = Fastify({
    trustProxy: true,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'req.body.password',
      ],
    },
  });

  const sessionStore = options.sessionStore ?? new PgSessionStore(pool);
  const identityService = options.identityService ?? new IdentityService(pool);

  // 1. Cookies
  await app.register(fastifyCookie);

  // 2. CORS
  const allowedOrigins = authConfig.corsOrigin.split(',').map((o) => o.trim()).filter(Boolean);
  await app.register(fastifyCors, {
    origin: allowedOrigins,
    credentials: true,
  });

  // 3. Rate Limit
  const rateLimitEnabled = options.rateLimit !== false;
  if (rateLimitEnabled) {
    await app.register(fastifyRateLimit, {
      global: false,
      errorResponseBuilder: (_request, context) => {
        const err = new AppError('RATE_LIMITED', 'Demasiadas solicitudes, intente más tarde', context.statusCode || 429);
        return err;
      },
    });
  }

  // 4. Gestión de Sesiones persistente en PostgreSQL
  await app.register(fastifySession, {
    secret: authConfig.sessionSecret,
    cookieName: authConfig.sessionCookieName,
    store: sessionStore,
    saveUninitialized: true,
    rolling: true,
    cookie: {
      path: '/api/v1',
      httpOnly: true,
      sameSite: 'lax',
      secure: authConfig.cookieSecure,
      maxAge: authConfig.sessionIdleTimeout,
    },
  });

  // 5. Protección CSRF vinculada a sesión
  await app.register(fastifyCsrfProtection, {
    sessionPlugin: '@fastify/session',
    getToken: (req) => {
      const h = req.headers['x-csrf-token'] || req.headers['csrf-token'];
      if (Array.isArray(h)) return h[0];
      return h as string | undefined;
    },
  });

  // Manejador centralizado de errores según contrato RFC3339 / ErrorResponse
  app.setErrorHandler((error, request, reply) => {
    let statusCode = error.statusCode ?? 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Error interno del servidor';
    let fields: Record<string, string[]> | undefined;

    if (error instanceof AppError) {
      statusCode = error.statusCode;
      code = error.code;
      message = error.message;
      fields = error.fields;
    } else if (statusCode === 429) {
      code = 'RATE_LIMITED';
      message = 'Demasiadas solicitudes, intente más tarde';
    } else if ((error as any).code === 'FST_CSRF_MISSING_SECRET' || (error as any).code === 'FST_CSRF_INVALID_TOKEN') {
      statusCode = 403;
      code = 'CSRF_INVALID';
      message = 'Token CSRF inválido o ausente';
    } else if (error.validation) {
      statusCode = 400;
      code = 'INVALID_INPUT';
      message = 'Datos de entrada inválidos';
      fields = {};
      for (const v of error.validation) {
        const fieldName = (v as any).instancePath?.replace(/^\//, '') || 'general';
        fields[fieldName] = fields[fieldName] || [];
        fields[fieldName].push(v.message ?? 'inválido');
      }
    } else if (statusCode >= 500) {
      request.log.error(error);
      message = 'Error interno del servidor';
    } else {
      message = error.message || 'Error en la solicitud';
    }

    reply.code(statusCode).send({
      code,
      message,
      requestId: request.id,
      ...(fields ? { fields } : {}),
    });
  });

  // 6. Healthchecks existentes
  app.get('/api/v1/health/live', async () => ({ status: 'ok' }));
  app.get('/api/v1/health/ready', async (_request, reply) => {
    const result = await readiness();
    if (!result.ready) reply.code(503);
    return result;
  });

  // 7. Módulo de Identidad y Sesiones (O04)
  await app.register(authPlugin, {
    prefix: '/api/v1',
    identityService,
    rateLimit: options.rateLimit,
  });

  return app;
}
