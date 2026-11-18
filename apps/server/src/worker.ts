import Fastify from 'fastify';
import { requireConfig } from './platform/config.ts';
import { readiness } from './platform/health.ts';
import { closeClients } from './platform/clients.ts';

requireConfig();
const app = Fastify({ logger: true });
app.get('/health/live', async () => ({ status: 'ok' }));
app.get('/health/ready', async (_request, reply) => {
  const result = await readiness();
  if (!result.ready) reply.code(503);
  return result;
});
process.on('SIGTERM', () => { void app.close().then(closeClients); });
await app.listen({ host: '0.0.0.0', port: 3001 });
