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
import { createRequireAuth } from './modules/identity/auth-hooks.ts';
import './modules/identity/auth-types.ts';
import { setAppErrorHandler } from './platform/error-handler.ts';
import { AppError } from './modules/identity/errors.ts';

export interface BuildAppOptions {
  sessionStore?: Parameters<typeof fastifySession>[1]['store'];
  sessionSecret?: string;
  identityService?: IdentityService;
  readinessCheck?: () => Promise<{ ready: boolean; checks: Record<string, boolean> }>;
  rateLimit?: boolean | {
    login?: { max: number; timeWindow: number };
    register?: { max: number; timeWindow: number };
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const sessionSecret = options.sessionSecret ?? authConfig.sessionSecret;
  requireAuthConfig(sessionSecret);

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
  app.decorate('requireAuth', createRequireAuth(identityService));

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
    secret: sessionSecret,
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

  setAppErrorHandler(app);

  // 6. Healthchecks existentes
  app.get('/api/v1/health/live', async () => ({ status: 'ok' }));
  app.get('/api/v1/health/ready', async (_request, reply) => {
    const result = await (options.readinessCheck ?? readiness)();
    if (!result.ready) {
      reply.code(503);
      return { status: 'unavailable' as const };
    }
    return { status: 'ok' as const };
  });
  app.get('/internal/health/diagnostics', async () => (options.readinessCheck ?? readiness)());

  // 7. Módulo de Identidad y Sesiones (O04)
  await app.register(authPlugin, {
    prefix: '/api/v1',
    identityService,
    rateLimit: options.rateLimit,
  });

  return app;
}
