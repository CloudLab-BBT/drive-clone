import { describe, expect, it } from 'vitest';
import { createApp } from './create-app.ts';

describe('health HTTP', () => {
  it('cumple el contrato público en 200 y 503 sin exponer diagnósticos', async () => {
    for (const ready of [true, false]) {
      const app = createApp(async () => ({ ready, checks: { database: ready } }));
      const response = await app.inject('/api/v1/health/ready');
      expect(response.statusCode).toBe(ready ? 200 : 503);
      expect(response.json()).toEqual({ status: ready ? 'ok' : 'unavailable' });
      await app.close();
    }
  });
});
