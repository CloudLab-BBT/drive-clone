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

  describe('Validacion de limites y duplicados', () => {
    it('rechaza entradas inválidas en límites de username (2 y 33 caracteres, no-ASCII, números/guion inicial)', async () => {
      const { csrfToken, cookie } = await getCsrfSession();

      // 2 caracteres
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: 'ab', password: 'password-valido-15' },
      });
      expect(res2.statusCode).toBe(400);

      // 33 caracteres
      const res33 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: 'u' + 'a'.repeat(32), password: 'password-valido-15' },
      });
      expect(res33.statusCode).toBe(400);

      // No inicia con letra
      const resNum = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: '1usuario', password: 'password-valido-15' },
      });
      expect(resNum.statusCode).toBe(400);

      // No-ASCII
      const resAscii = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: 'usuá_rio', password: 'password-valido-15' },
      });
      expect(resAscii.statusCode).toBe(400);
    });

    it('rechaza contraseñas fuera de límites (14 y 129 caracteres)', async () => {
      const { csrfToken, cookie } = await getCsrfSession();

      const res14 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: 'usr' + Math.floor(Math.random() * 1000), password: 'a'.repeat(14) },
      });
      expect(res14.statusCode).toBe(400);

      const res129 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: 'usr' + Math.floor(Math.random() * 1000), password: 'a'.repeat(129) },
      });
      expect(res129.statusCode).toBe(400);
    });

    it('rechaza username duplicado y maneja condiciones de carrera (Promise.all) devolviendo 409 Conflict', async () => {
      const targetUser = 'raceuser' + Math.floor(Math.random() * 10000);
      const sessionA = await getCsrfSession();
      const sessionB = await getCsrfSession();

      // Solicitudes concurrentes con el mismo username
      const [resA, resB] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': sessionA.csrfToken, cookie: sessionA.cookie },
          payload: { username: targetUser, password: 'password-de-prueba-15' },
        }),
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': sessionB.csrfToken, cookie: sessionB.cookie },
          payload: { username: targetUser, password: 'password-de-prueba-15' },
        }),
      ]);

      const statusCodes = [resA.statusCode, resB.statusCode].sort();
      expect(statusCodes).toEqual([201, 409]);

      const conflictRes = resA.statusCode === 409 ? resA : resB;
      expect(conflictRes.json().code).toBe('USERNAME_TAKEN');
    });
  });
});
