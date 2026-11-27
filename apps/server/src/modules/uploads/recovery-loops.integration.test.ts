import { ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeClients, pool, sqs } from '../../platform/clients.ts';
import { acquire } from './process-acquire.ts';
import { renew } from './process.ts';
import { publishOutbox } from './outbox.ts';
import { consumeQueue } from './consumer.ts';
import { queued } from './recovery-fixture.ts';

const suite = process.env.RUN_O13_INTEGRATION === 'true' ? describe : describe.skip;
suite('ciclos independientes del trabajador', () => {
  afterAll(async () => {
    await closeClients();
  });

  it('publica Outbox y renueva lease mientras SQS mantiene el long polling', async () => {
    const processing = await queued();
    const acquired = await acquire(processing.upload.id);
    const pending = await queued();
    await pool.query(
      `UPDATE "Outbox" SET "createdAt" = now() - interval '1 day'
      WHERE "entityId" = $1`,
      [pending.upload.id],
    );
    let release!: () => void;
    let entered!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const original = sqs.send.bind(sqs);
    const spy = vi.spyOn(sqs, 'send').mockImplementation((async (command: unknown) => {
      if (command instanceof ReceiveMessageCommand) {
        entered();
        await hold;
        return { Messages: [] };
      }
      return original(command as never);
    }) as typeof sqs.send);
    try {
      const polling = consumeQueue();
      await started;
      await Promise.race([
        Promise.all([publishOutbox(), renew(processing.upload.id, acquired!.attemptId)]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ciclos bloqueados')), 3000)),
      ]);
      const sent = await pool.query<{ publishedAt: Date | null }>(
        'SELECT "publishedAt" FROM "Outbox" WHERE "entityId" = $1',
        [pending.upload.id],
      );
      expect(sent.rows[0].publishedAt).not.toBeNull();
      const lease = await pool.query<{ valid: boolean }>(
        `SELECT "leaseUntil" > now() AS valid
        FROM "Upload" WHERE id = $1`,
        [processing.upload.id],
      );
      expect(lease.rows[0].valid).toBe(true);
      release();
      await polling;
    } finally {
      release();
      spy.mockRestore();
    }
  }, 10_000);
});
