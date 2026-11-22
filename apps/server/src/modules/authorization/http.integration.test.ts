import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { closeClients, pool } from '../../platform/clients.ts';
import { AuthorizationService, requireResourceAccess } from './index.ts';

afterAll(closeClients);

describe('Identidad de O04 y autorización de O05', () => {
  it('evalúa una lectura con la identidad de la sesión autenticada', async () => {
    const app = await buildApp({
      sessionSecret: 'clave-ficticia-para-pruebas-locales-de-o05',
    });
    const requireAccess = requireResourceAccess(new AuthorizationService(pool));
    await app.register(async (routes) => {
      routes.get<{ Params: { id: string } }>('/probe/:id', {
        preHandler: routes.requireAuth,
      }, async (request) => {
        const result = await requireAccess(request, request.params.id, 'VIEW');
        return { permission: result.effectivePermission };
      });
    }, { prefix: '/api/v1' });

    try {
      const origin = 'http://127.0.0.1:8080';
      const csrf = await app.inject('/api/v1/auth/csrf');
      const registration = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: {
          origin,
          'x-csrf-token': csrf.json().csrfToken,
          cookie: csrf.headers['set-cookie'] as string,
        },
        payload: {
          username: 't' + randomUUID().replaceAll('-', '').slice(0, 20),
          password: 'frase ficticia para validar el registro',
        },
      });
      expect(registration.statusCode).toBe(201);
      const path = '/api/v1/probe/' + registration.json().user.rootId;
      expect((await app.inject(path)).statusCode).toBe(401);
      const response = await app.inject({
        url: path,
        headers: { cookie: registration.headers['set-cookie'] as string },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ permission: 'OWNER' });
    } finally {
      await app.close();
    }
  });
});
