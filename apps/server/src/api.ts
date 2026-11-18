import Fastify from 'fastify';
import { config, requireConfig } from './platform/config.ts';
import { readiness } from './platform/health.ts';
import { closeClients } from './platform/clients.ts';

requireConfig();
const app = Fastify({ logger: true });
app.get('/api/v1/health/live', async () => ({ status: 'ok' }));
app.get('/api/v1/health/ready', async (_request, reply) => {
  const result = await readiness();
  if (!result.ready) reply.code(503);
  return result;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void app.close().then(closeClients); });
}

await app.listen({ host: '0.0.0.0', port: config.port });
