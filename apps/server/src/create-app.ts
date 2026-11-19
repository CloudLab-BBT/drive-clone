import Fastify from 'fastify';
import { Health } from '@drive-clone/contracts';
import { readiness } from './platform/health.ts';

export function createApp(check = readiness) {
  const app = Fastify({ logger: true });
  app.get('/api/v1/health/live', { schema: { response: { 200: Health } } },
    async () => ({ status: 'ok' as const }));
  app.get('/api/v1/health/ready', { schema: { response: { 200: Health, 503: Health } } },
    async (_request, reply) => {
      const result = await check();
      if (!result.ready) reply.code(503);
      return { status: result.ready ? 'ok' as const : 'unavailable' as const };
    });
  app.get('/internal/health/diagnostics', async () => check());
  return app;
}
