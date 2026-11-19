import { config, requireConfig } from './platform/config.ts';
import { requireAuthConfig } from './platform/auth-config.ts';
import { closeClients } from './platform/clients.ts';
import { buildApp } from './app.ts';

requireConfig();
requireAuthConfig();

const app = await buildApp();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(closeClients);
  });
}

await app.listen({ host: '0.0.0.0', port: config.port });
