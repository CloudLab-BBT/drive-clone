import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { closeClients } from '../../platform/clients.ts';

describe('requireAuth en plugin hermano', () => {
  it('rechaza sin sesion y expone actorId con sesion activa', async () => {
    const app = await buildApp({ rateLimit: false });
    await app.register(async (sibling) => {
      sibling.get('/private-sibling', { preHandler: [sibling.requireAuth] },
        async (request) => ({ actorId: request.user?.id }));
    }, { prefix: '/api/v1' });
    await app.ready();

    const denied = await app.inject('/api/v1/private-sibling');
    expect(denied.statusCode).toBe(401);

    const csrf = await app.inject('/api/v1/auth/csrf');
    const cookie = csrf.headers['set-cookie'] as string;
    const username = 'sibling' + Math.floor(Math.random() * 10000);
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: {
        origin: 'http://127.0.0.1:8080',
        'x-csrf-token': csrf.json().csrfToken,
        cookie,
      },
      payload: { username, password: 'password-valido-15' },
    });
    expect(registered.statusCode).toBe(201);
    const authCookie = registered.headers['set-cookie'] as string;
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/private-sibling',
      headers: { cookie: authCookie },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().actorId).toBe(registered.json().user.id);

    await app.close();
    await closeClients();
  });
});
