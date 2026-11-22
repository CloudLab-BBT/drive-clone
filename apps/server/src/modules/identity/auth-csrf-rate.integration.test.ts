import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { pool, closeClients } from '../../platform/clients.ts';

describe('Suite de Integración: Registro, Autenticación y Sesiones (O04)', () => {
  let app: FastifyInstance;
  const ALLOWED_ORIGIN = 'http://127.0.0.1:8080';

  beforeAll(async () => {
    // Para la suite principal desactivamos rateLimit para evitar que los tests se bloqueen entre sí
    app = await buildApp({ rateLimit: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  // Helper para obtener token CSRF y cookie de sesión previa
  async function getCsrfSession(): Promise<{ csrfToken: string; cookie: string }> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/csrf',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const cookie = res.headers['set-cookie'] as string;
    return { csrfToken: body.csrfToken, cookie };
  }

  // --- 4. CSRF y Verificación de Origen ---
  describe('CSRF y Origen', () => {
    it('rechaza mutaciones si falta el token CSRF (403)', async () => {
      const { cookie } = await getCsrfSession();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, cookie },
        payload: { username: 'testuser', password: 'password-valido-15' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('CSRF_INVALID');
    });

    it('rechaza mutaciones si el token CSRF es inválido (403)', async () => {
      const { cookie } = await getCsrfSession();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: {
          origin: ALLOWED_ORIGIN,
          'x-csrf-token': 'token-falso-invalido',
          cookie,
        },
        payload: { username: 'testuser', password: 'password-valido-15' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('CSRF_INVALID');
    });

    it('rechaza mutaciones si la cabecera Origin es diferente al origen permitido (403)', async () => {
      const { csrfToken, cookie } = await getCsrfSession();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: {
          origin: 'http://malicious-site.com',
          'x-csrf-token': csrfToken,
          cookie,
        },
        payload: { username: 'testuser', password: 'password-valido-15' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('CSRF_INVALID');
    });
  });

  // --- 5. Rate Limiting ---
  describe('Rate Limiting', () => {
    it('activa 429 Too Many Requests tras superar el umbral de intentos', async () => {
      // Instancia con rateLimit estricto de 2 solicitudes para probar el disparo
      const rateLimitedApp = await buildApp({
        rateLimit: {
          login: { max: 2, timeWindow: 60000 },
        },
      });
      await rateLimitedApp.ready();

      const { csrfToken, cookie } = await getCsrfSession();

      // Petición 1: pasa
      const r1 = await rateLimitedApp.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: 'nonexistent', password: 'password-valido-15' },
      });
      expect(r1.statusCode).toBe(401);

      // Petición 2: pasa
      const r2 = await rateLimitedApp.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: 'nonexistent', password: 'password-valido-15' },
      });
      expect(r2.statusCode).toBe(401);

      // Petición 3: debe bloquearse con 429
      const r3 = await rateLimitedApp.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: 'nonexistent', password: 'password-valido-15' },
      });
      expect(r3.statusCode).toBe(429);
      expect(r3.json().code).toBe('RATE_LIMITED');
      expect(r3.headers['retry-after']).toBeDefined();

      await rateLimitedApp.close();
    });
  });

});
