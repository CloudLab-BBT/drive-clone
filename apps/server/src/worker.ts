import Fastify from 'fastify';
import { requireConfig } from './platform/config.ts';
import { readiness } from './platform/health.ts';
import { closeClients } from './platform/clients.ts';
import { consumeQueue, publishOutbox, reconcileExpired } from './modules/uploads/queue.ts';

requireConfig();
const app = Fastify({ logger: true });
app.get('/health/live', async () => ({ status: 'ok' }));
app.get('/health/ready', async (_request, reply) => {
  const result = await readiness();
  if (!result.ready) reply.code(503);
  return { status: result.ready ? 'ok' : 'unavailable' };
});
app.get('/internal/health/diagnostics', async () => readiness());
let running = true;
process.on('SIGTERM', () => { running = false; void app.close().then(closeClients); });
await app.listen({ host: '0.0.0.0', port: 3001 });

async function loop(operation: () => Promise<void>, delay: number) {
  while (running) {
    try { await operation(); } catch (error) { app.log.error(error); }
    if (running) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

void loop(publishOutbox, 1000);
void loop(consumeQueue, 0);
void loop(reconcileExpired, 20_000);
