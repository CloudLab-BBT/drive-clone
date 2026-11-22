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

  describe('Cierre de sesion', () => {
    it('cierra sesión con logout, revoca en PostgreSQL y rechaza reutilizar la cookie anterior (401)', async () => {
      // 1. Registrar y obtener sesión autenticada
      const username = 'logoutuser' + Math.floor(Math.random() * 10000);
      const password = 'passphrase-para-logout-15';
      const s1 = await getCsrfSession();
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': s1.csrfToken, cookie: s1.cookie },
        payload: { username, password },
      });
      expect(regRes.statusCode).toBe(201);
      const authCookie = regRes.headers['set-cookie'] as string;

      // 2. Obtener nuevo CSRF para la sesión autenticada
      const csrfRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/csrf',
        headers: { cookie: authCookie },
      });
      const authCsrfToken = csrfRes.json().csrfToken;

      // 3. Verificar que me funciona con authCookie
      const meBefore = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: authCookie },
      });
      expect(meBefore.statusCode).toBe(200);

      // 4. Ejecutar Logout
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          origin: ALLOWED_ORIGIN,
          'x-csrf-token': authCsrfToken,
          cookie: authCookie,
        },
      });
      expect(logoutRes.statusCode).toBe(204);

      // 5. Intentar reutilizar authCookie debe fallar con 401
      const meAfter = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: authCookie },
      });
      expect(meAfter.statusCode).toBe(401);
      expect(meAfter.json().code).toBe('UNAUTHENTICATED');
    });
  });
});
