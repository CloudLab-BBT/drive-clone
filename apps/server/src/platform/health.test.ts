import { describe, expect, it } from 'vitest';
import fastifySession from '@fastify/session';
import { buildApp } from '../app.ts';
import { bounded } from './health.ts';

const TEST_SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';

describe('comprobación de dependencias', () => {
  it('distingue éxito, fallo y timeout sin exponer la causa', async () => {
    expect(await bounded('db', async () => true, 20)).toEqual(['db', true]);
    expect(await bounded('db', async () => { throw new Error('secreto'); }, 20)).toEqual(['db', false]);
    expect(await bounded('db', () => new Promise(() => {}), 5)).toEqual(['db', false]);
    expect(await bounded('db', async () => true, 20)).toEqual(['db', true]);
  });

  describe('health HTTP con buildApp', () => {
    it('devuelve solo status ok/unavailable en 200 y 503', async () => {
      for (const ready of [true, false]) {
        const app = await buildApp({
          rateLimit: false,
          sessionSecret: TEST_SESSION_SECRET,
          sessionStore: new fastifySession.MemoryStore(),
          readinessCheck: async () => ({ ready, checks: { database: ready } }),
        });
        await app.ready();
        const response = await app.inject('/api/v1/health/ready');
        expect(response.statusCode).toBe(ready ? 200 : 503);
        expect(response.json()).toEqual({ status: ready ? 'ok' : 'unavailable' });
        await app.close();
      }
    });

    it('devuelve diagnósticos completos sin acceder a PostgreSQL', async () => {
      const app = await buildApp({
        rateLimit: false,
        sessionSecret: TEST_SESSION_SECRET,
        sessionStore: new fastifySession.MemoryStore(),
        readinessCheck: async () => ({
          ready: false,
          checks: { database: false, bucket: true, queue: true, dlq: true, temporary: true },
        }),
      });
      await app.ready();

      const response = await app.inject('/internal/health/diagnostics');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ready: false,
        checks: { database: false, bucket: true, queue: true, dlq: true, temporary: true },
      });
      await app.close();
    });
  });
});
