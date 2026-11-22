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

  describe('Expiracion de sesion', () => {
    it('rechaza sesión expirada por límite absoluto de 8 horas (401)', async () => {
      // Registrar usuario
      const username = 'expuser' + Math.floor(Math.random() * 10000);
      const password = 'passphrase-para-exp-15';
      const s1 = await getCsrfSession();
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': s1.csrfToken, cookie: s1.cookie },
        payload: { username, password },
      });
      const authCookie = regRes.headers['set-cookie'] as string;

      // Encontrar la sesión en la base de datos y simular creación hace 9 horas (>8 horas)
      const nineHoursAgo = Date.now() - 9 * 60 * 60 * 1000;
      await pool.query(
        `UPDATE "Session"
         SET data = jsonb_set(data, '{authCreatedAt}', $1::jsonb)
         WHERE "userId" = $2`,
        [JSON.stringify(nineHoursAgo), regRes.json().user.id],
      );

      // Intentar acceder con esa sesión debe devolver 401
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: authCookie },
      });
      expect(meRes.statusCode).toBe(401);
      expect(meRes.json().code).toBe('UNAUTHENTICATED');
    });

    it('rechaza sesión expirada por inactividad de 30 minutos (401)', async () => {
      // Registrar usuario
      const username = 'idleuser' + Math.floor(Math.random() * 10000);
      const password = 'passphrase-para-idle-15';
      const s1 = await getCsrfSession();
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': s1.csrfToken, cookie: s1.cookie },
        payload: { username, password },
      });
      const authCookie = regRes.headers['set-cookie'] as string;

      // Simular última actividad hace 35 minutos (>30 minutos)
      const thirtyFiveMinAgo = Date.now() - 35 * 60 * 1000;
      await pool.query(
        `UPDATE "Session"
         SET data = jsonb_set(data, '{lastActivity}', $1::jsonb)
         WHERE "userId" = $2`,
        [JSON.stringify(thirtyFiveMinAgo), regRes.json().user.id],
      );

      // Intentar acceder con esa sesión debe devolver 401
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: authCookie },
      });
      expect(meRes.statusCode).toBe(401);
      expect(meRes.json().code).toBe('UNAUTHENTICATED');
    });
  });
});
