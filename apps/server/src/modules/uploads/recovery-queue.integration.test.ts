import { randomUUID } from 'node:crypto';
import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeClients, pool, sqs } from '../../platform/clients.ts';
import { publishOutbox, reconcileQueued } from './outbox.ts';
import { observe } from './queue-observation.ts';
import { processUpload } from './process.ts';
import { queued, store } from './recovery-fixture.ts';

const suite = process.env.RUN_O13_INTEGRATION === 'true' ? describe : describe.skip;
suite('Outbox, SQS y diagnóstico DLQ', () => {
  afterAll(async () => {
    await closeClients();
  });

  it('mantiene el evento pendiente hasta la confirmación SQS y reintenta', async () => {
    const { upload } = await queued();
    await pool.query(
      `UPDATE "Outbox" SET "createdAt" = now() - interval '1 day'
      WHERE "entityId" = $1`,
      [upload.id],
    );
    const original = sqs.send.bind(sqs);
    const spy = vi.spyOn(sqs, 'send').mockImplementation((async (command: unknown) => {
      if (command instanceof SendMessageCommand) throw new Error('SQS no confirmó');
      return original(command as never);
    }) as typeof sqs.send);
    try {
      await publishOutbox();
    } finally {
      spy.mockRestore();
    }
    const failed = await pool.query<{ publishedAt: Date | null; errorCode: string }>(
      'SELECT "publishedAt","errorCode" FROM "Outbox" WHERE "entityId" = $1',
      [upload.id],
    );
    expect(failed.rows[0].publishedAt).toBeNull();
    expect(failed.rows[0].errorCode).toBe('PUBLISH_FAILED');
    await pool.query('UPDATE "Outbox" SET "availableAt" = now() WHERE "entityId" = $1', [
      upload.id,
    ]);
    await publishOutbox();
    const sent = await pool.query<{ publishedAt: Date | null }>(
      'SELECT "publishedAt" FROM "Outbox" WHERE "entityId" = $1',
      [upload.id],
    );
    expect(sent.rows[0].publishedAt).not.toBeNull();
  });

  it('reconstruye Outbox si el mensaje enviado se pierde', async () => {
    const { upload } = await queued();
    const original = await pool.query<{ id: string }>(
      'SELECT id FROM "Outbox" WHERE "entityId" = $1',
      [upload.id],
    );
    await pool.query(
      `UPDATE "Outbox" SET "publishedAt" = now() - interval '61 seconds'
      WHERE "entityId" = $1`,
      [upload.id],
    );
    await pool.query(
      `UPDATE "Upload" SET "updatedAt" = now() - interval '1 day'
      WHERE id = $1`,
      [upload.id],
    );
    await reconcileQueued();
    const pending = await pool.query(
      `SELECT id FROM "Outbox" WHERE "entityId" = $1
      AND "publishedAt" IS NULL`,
      [upload.id],
    );
    expect(pending.rowCount).toBe(1);
    expect(pending.rows[0].id).toBe(original.rows[0].id);
    const constraint = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_indexes
        WHERE indexname = 'Outbox_type_entityId_version_key') AS "exists"`,
    );
    expect(constraint.rows[0].exists).toBe(true);
  });

  it('distingue recepciones SQS del único intento de negocio', async () => {
    const { upload, userId } = await queued();
    const url = (
      await sqs.send(
        new CreateQueueCommand({
          QueueName: `o13-observation-${randomUUID()}`,
        }),
      )
    ).QueueUrl!;
    const body = JSON.stringify({ version: 1, type: 'UPLOAD', id: upload.id });
    try {
      await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: body }));
      const receive = async () =>
        (
          await sqs.send(
            new ReceiveMessageCommand({
              QueueUrl: url,
              WaitTimeSeconds: 1,
              VisibilityTimeout: 0,
              MaxNumberOfMessages: 10,
              MessageSystemAttributeNames: ['ApproximateReceiveCount'],
            }),
          )
        ).Messages ?? [];
      let first = (await receive()).find((message) => message.Body === body);
      for (let i = 0; !first && i < 5; i++)
        first = (await receive()).find((message) => message.Body === body);
      expect(first).toBeDefined();
      await observe(first!, 'MAIN', upload.id, 'RECEIVED');
      await sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: url,
          ReceiptHandle: first!.ReceiptHandle,
          VisibilityTimeout: 0,
        }),
      );
      let second = (await receive()).find((message) => message.MessageId === first!.MessageId);
      for (let i = 0; !second && i < 5; i++)
        second = (await receive()).find((message) => message.MessageId === first!.MessageId);
      expect(second).toBeDefined();
      await observe(second!, 'MAIN', upload.id, 'RECEIVED');
      const counts = await pool.query<{ receiveCount: number }>(
        `SELECT "receiveCount"
      FROM "QueueObservation" WHERE "uploadId" = $1 AND source = 'MAIN'
      ORDER BY "receiveCount"`,
        [upload.id],
      );
      expect(counts.rows.map((row) => row.receiveCount)).toEqual([1, 2]);
      expect((await store.get(upload.id, userId)).attemptCount).toBe(0);
      await sqs.send(
        new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: second!.ReceiptHandle }),
      );
      expect(await processUpload(upload.id)).toBe(true);
      expect((await store.get(upload.id, userId)).attemptCount).toBe(1);
    } finally {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: url }));
    }
  }, 30_000);
});
