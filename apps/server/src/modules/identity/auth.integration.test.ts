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

  // --- 1. Registro ---
  describe('Registro de usuario', () => {
    it('registra un usuario válido y crea su raíz protegida', async () => {
      const { csrfToken, cookie } = await getCsrfSession();
      const username = 'validuser' + Math.floor(Math.random() * 10000);
      const password = 'frase de paso valida con espacios';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: {
          origin: ALLOWED_ORIGIN,
          'x-csrf-token': csrfToken,
          cookie,
        },
        payload: { username, password },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.user).toBeDefined();
      expect(body.user.username).toBe(username.toLowerCase());
      expect(body.user.id).toBeDefined();
      expect(body.user.rootId).toBeDefined();

      // Verificar en BD que la raíz se creó con los atributos protegidos
      const rootRes = await pool.query(
        'SELECT id, "ownerId", "parentId", kind, "isRoot", status FROM "Resource" WHERE id = $1',
        [body.user.rootId],
      );
      expect(rootRes.rows.length).toBe(1);
      const root = rootRes.rows[0];
      expect(root.isRoot).toBe(true);
      expect(root.parentId).toBeNull();
      expect(root.kind).toBe('FOLDER');
      expect(root.status).toBe('ACTIVE');
      expect(root.ownerId).toBe(body.user.id);
    });

    it('normaliza username a minúsculas y elimina espacios', async () => {
      const { csrfToken, cookie } = await getCsrfSession();
      const rawUser = '  UserConMayus' + Math.floor(Math.random() * 1000);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': csrfToken, cookie },
        payload: { username: rawUser, password: 'contrasenia-valida-15' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().user.username).toBe(rawUser.trim().toLowerCase());
    });

    it('acepta límites de username (3 y 32 caracteres) y contraseñas (15 y 128)', async () => {
      // 3 caracteres username
      const u3 = 'u' + Math.floor(Math.random() * 90 + 10);
      const p15 = 'a'.repeat(15);
      const session1 = await getCsrfSession();
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': session1.csrfToken, cookie: session1.cookie },
        payload: { username: u3, password: p15 },
      });
      expect(res1.statusCode).toBe(201);

      // 32 caracteres username y 128 caracteres password
      const u32 = 'u' + Math.random().toString(36).slice(2).padEnd(31, 'a');
      const p128 = 'p'.repeat(128);
      const session2 = await getCsrfSession();
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': session2.csrfToken, cookie: session2.cookie },
        payload: { username: u32, password: p128 },
      });
      expect(res2.statusCode).toBe(201);
    });

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

  // --- 3. Ciclo de Vida de Sesión ---
  describe('Ciclo de vida de sesión', () => {
    it('bloquea acceso a endpoints privados sin sesión (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHENTICATED');
    });

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

  // --- 6. Raíz Protegida en Base de Datos ---
  describe('Protección de raíz a nivel de triggers de Base de Datos', () => {
    it('impide eliminar o renombrar la raíz mediante triggers en PostgreSQL', async () => {
      // 1. Registrar usuario
      const username = 'rootcheck' + Math.floor(Math.random() * 10000);
      const session = await getCsrfSession();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: ALLOWED_ORIGIN, 'x-csrf-token': session.csrfToken, cookie: session.cookie },
        payload: { username, password: 'password-valido-15' },
      });
      expect(res.statusCode).toBe(201);
      const rootId = res.json().user.rootId;

      // 2. Intentar renombrar la raíz directamente en SQL debe lanzar excepción del trigger
      await expect(
        pool.query('UPDATE "Resource" SET name = $1 WHERE id = $2', ['nuevo_nombre', rootId]),
      ).rejects.toThrow(/La raíz está protegida/);

      // 3. Intentar eliminar la raíz directamente en SQL debe lanzar excepción del trigger
      await expect(
        pool.query('DELETE FROM "Resource" WHERE id = $1', [rootId]),
      ).rejects.toThrow(/La raíz está protegida/);
    });
  });
});
