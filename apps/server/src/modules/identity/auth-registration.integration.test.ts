import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
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
      const u3 = 'u' + randomUUID().replace(/-/g, '').slice(0, 2);
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
      const u32 = 'u' + randomUUID().replace(/-/g, '').slice(0, 31);
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
  });
});
