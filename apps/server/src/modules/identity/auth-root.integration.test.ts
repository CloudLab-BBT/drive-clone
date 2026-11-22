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
