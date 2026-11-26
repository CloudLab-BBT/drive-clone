import { GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { afterAll, describe, expect, it } from 'vitest';
import { closeClients, pool, sqs } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { reconcileDlq } from './dlq.ts';
import { processUpload } from './process.ts';
import { acquire } from './process-acquire.ts';
import { queued } from './recovery-fixture.ts';

const suite = process.env.RUN_O13_INTEGRATION === 'true' ? describe : describe.skip;
suite('reconciliación de DLQ', () => {
  afterAll(async () => {
    await closeClients();
  });

  async function send(id: string) {
    const url = (await sqs.send(new GetQueueUrlCommand({ QueueName: config.dlqName }))).QueueUrl!;
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: url,
        MessageBody: JSON.stringify({ version: 1, type: 'UPLOAD', id }),
      }),
    );
  }

  it('despierta una carga en cola y registra la recuperación', async () => {
    const { upload } = await queued();
    await pool.query(`UPDATE "Outbox" SET "publishedAt" = now() WHERE "entityId" = $1`, [
      upload.id,
    ]);
    await send(upload.id);
    await reconcileDlq();
    const observed = await pool.query<{ outcome: string }>(
      `SELECT outcome FROM "QueueObservation" WHERE "uploadId" = $1 AND source = 'DLQ'`,
      [upload.id],
    );
    expect(observed.rows[0].outcome).toBe('RECOVERED');
    const pending = await pool.query(
      `SELECT id FROM "Outbox" WHERE "entityId" = $1
      AND "publishedAt" IS NULL`,
      [upload.id],
    );
    expect(pending.rowCount).toBe(1);
  });

  it('distingue cargas activas y terminales', async () => {
    const active = await queued();
    await acquire(active.upload.id);
    const terminal = await queued();
    expect(await processUpload(terminal.upload.id)).toBe(true);
    await send(active.upload.id);
    await send(terminal.upload.id);
    await reconcileDlq();
    const states = await pool.query<{ uploadId: string; outcome: string }>(
      `SELECT "uploadId",outcome FROM "QueueObservation" WHERE source = 'DLQ'
      AND "uploadId" = ANY($1::uuid[])`,
      [[active.upload.id, terminal.upload.id]],
    );
    expect(Object.fromEntries(states.rows.map((row) => [row.uploadId, row.outcome]))).toEqual({
      [active.upload.id]: 'ACTIVE',
      [terminal.upload.id]: 'TERMINAL',
    });
  });
});
