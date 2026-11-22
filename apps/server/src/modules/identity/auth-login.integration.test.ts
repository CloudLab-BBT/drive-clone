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

  // --- 2. Login ---
  describe('Inicio de sesión', () => {
    const loginUser = 'logintest' + Math.floor(Math.random() * 10000);
    const loginPass = 'password-de-login-valido-15';

    beforeAll(async () => {
      const { csrfToken, cookie } = await getCsrfSession();
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: loginUser, password: loginPass },
      });
    });

    it('inicia sesión exitosamente con credenciales válidas y regenera la cookie de sesión', async () => {
      const { csrfToken, cookie: preCookie } = await getCsrfSession();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie: preCookie },
        payload: { username: loginUser, password: loginPass },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.username).toBe(loginUser.toLowerCase());
      expect(body.user.rootId).toBeDefined();

      const postCookie = res.headers['set-cookie'] as string;
      expect(postCookie).toBeDefined();
      expect(postCookie).not.toEqual(preCookie);
    });

    it('rechaza login con contraseña incorrecta devolviendo 401 UNAUTHENTICATED genérico', async () => {
      const { csrfToken, cookie } = await getCsrfSession();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: loginUser, password: 'password-totalmente-incorrecto' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHENTICATED');
      expect(res.json().message).toBe('Credenciales inválidas');
    });

    it('rechaza login con usuario inexistente devolviendo el mismo 401 UNAUTHENTICATED (sin enumeración)', async () => {
      const { csrfToken, cookie } = await getCsrfSession();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: 'nonexistentuser999', password: 'password-valido-15' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHENTICATED');
      expect(res.json().message).toBe('Credenciales inválidas');
    });
  });

});
