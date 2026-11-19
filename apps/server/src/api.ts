import { config, requireConfig } from './platform/config.ts';
import { closeClients } from './platform/clients.ts';
import { createApp } from './create-app.ts';

requireConfig();
const app = createApp();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void app.close().then(closeClients); });
}

await app.listen({ host: '0.0.0.0', port: config.port });
