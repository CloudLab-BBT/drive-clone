import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export async function folderSession(app: FastifyInstance) {
  const origin = 'http://127.0.0.1:8080';
  const csrf = await app.inject({ url: '/api/v1/auth/csrf' });
  const registration = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: {
      origin,
      cookie: String(csrf.headers['set-cookie']).split(';')[0],
      'x-csrf-token': csrf.json().csrfToken,
    },
    payload: {
      username: `u${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      password: randomUUID(),
    },
  });
  if (registration.statusCode !== 201) throw new Error('No se pudo crear la sesión de prueba');
  const cookie = String(registration.headers['set-cookie']).split(';')[0];
  const token = await app.inject({ url: '/api/v1/auth/csrf', headers: { cookie } });
  const headers = { cookie, origin, 'x-csrf-token': token.json().csrfToken as string };
  const { id, rootId } = registration.json().user as { id: string; rootId: string };
  return {
    id,
    rootId,
    headers,
    create: (parentId: string, name: string) =>
      app.inject({ method: 'POST', url: '/api/v1/folders', headers, payload: { parentId, name } }),
    list: (parentId: string) =>
      app.inject({ url: `/api/v1/folders/${parentId}/children`, headers: { cookie } }),
    reserve: (parentId: string, name: string, size = 10) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        headers,
        payload: { parentId, name, size },
      }),
  };
}
