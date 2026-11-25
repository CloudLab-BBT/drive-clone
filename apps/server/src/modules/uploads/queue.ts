import { randomUUID } from 'node:crypto';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { pool, sqs } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { processUpload } from './process.ts';
import { UploadStore } from './store.ts';
import { cleanupCancellation, cleanupFailed } from './cancel.ts';

let queueUrl: string | undefined;
async function url() {
  if (!queueUrl)
    queueUrl = (await sqs.send(new GetQueueUrlCommand({ QueueName: config.queueName }))).QueueUrl;
  if (!queueUrl) throw new Error('Cola SQS no disponible');
  return queueUrl;
}

export async function publishOutbox(): Promise<void> {
  const attemptId = randomUUID();
  const result = await pool.query<{ id: string; payload: unknown }>(
    `UPDATE "Outbox" o SET "attemptId" = $1,
    "leaseUntil" = now() + interval '60 seconds', "publishAttempts" = "publishAttempts" + 1
    FROM (SELECT id FROM "Outbox" WHERE "publishedAt" IS NULL AND "availableAt" <= now()
      AND ("leaseUntil" IS NULL OR "leaseUntil" < now()) ORDER BY "createdAt" LIMIT 10 FOR UPDATE SKIP LOCKED) next
    WHERE o.id = next.id RETURNING o.id,o.payload`,
    [attemptId],
  );
  for (const row of result.rows) {
    try {
      await sqs.send(
        new SendMessageCommand({ QueueUrl: await url(), MessageBody: JSON.stringify(row.payload) }),
      );
      await pool.query(
        `UPDATE "Outbox" SET "publishedAt" = now(), "attemptId" = NULL,
        "leaseUntil" = NULL WHERE id = $1 AND "attemptId" = $2`,
        [row.id, attemptId],
      );
    } catch {
      await pool.query(
        `UPDATE "Outbox" SET "attemptId" = NULL, "leaseUntil" = NULL,
        "errorCode" = 'PUBLISH_FAILED', "availableAt" = now() + interval '10 seconds'
        WHERE id = $1 AND "attemptId" = $2`,
        [row.id, attemptId],
      );
    }
  }
}

export async function consumeQueue(): Promise<void> {
  const result = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: await url(),
      WaitTimeSeconds: 20,
      VisibilityTimeout: 60,
      MaxNumberOfMessages: 1,
    }),
  );
  for (const message of result.Messages ?? []) {
    let acknowledged = false;
    try {
      const body = JSON.parse(message.Body ?? '') as {
        version?: number;
        type?: string;
        id?: string;
      };
      if (
        body.version === 1 &&
        body.type === 'UPLOAD' &&
        typeof body.id === 'string' &&
        /^[0-9a-f-]{36}$/i.test(body.id)
      )
        acknowledged = await processUpload(body.id, async () => {
          await sqs.send(
            new ChangeMessageVisibilityCommand({
              QueueUrl: await url(),
              ReceiptHandle: message.ReceiptHandle,
              VisibilityTimeout: 60,
            }),
          );
        });
    } catch {
      /* SQS reentregará o enviará a DLQ. */
    }
    if (acknowledged && message.ReceiptHandle)
      await sqs.send(
        new DeleteMessageCommand({ QueueUrl: await url(), ReceiptHandle: message.ReceiptHandle }),
      );
  }
}

export async function reconcileExpired(): Promise<void> {
  await pool.query(`UPDATE "Upload" SET status = 'QUEUED', "attemptId" = NULL,
    "leaseUntil" = NULL, "nextAttemptAt" = now(), "updatedAt" = now()
    WHERE status = 'PROCESSING' AND "leaseUntil" < now() AND "attemptCount" < 3`);
  await pool.query(`UPDATE "Upload" SET status = 'FAILED', "errorCode" = 'PROCESSING_FAILED',
    "cleanupPending" = true, "attemptId" = NULL, "leaseUntil" = NULL, "updatedAt" = now()
    WHERE status = 'PROCESSING' AND "leaseUntil" < now() AND "attemptCount" >= 3`);
  const expired = await pool.query<{ id: string; status: string }>(`SELECT id,status FROM "Upload"
    WHERE (status = 'CREATED' AND "createdAt" < now() - interval '15 minutes')
    OR (status = 'RECEIVING' AND "updatedAt" < now() - interval '10 minutes') LIMIT 20`);
  const store = new UploadStore(pool);
  for (const row of expired.rows)
    await store.fail(row.id, row.status === 'CREATED' ? 'EXPIRED' : 'RECEIVE_INTERRUPTED');
  const cancelled = await pool.query<{ id: string }>(`SELECT id FROM "Upload"
    WHERE status = 'CANCEL_REQUESTED' AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
    ORDER BY "cancelRequestedAt" LIMIT 20`);
  for (const row of cancelled.rows) await cleanupCancellation(row.id);
  const failed = await pool.query<{ id: string }>(`SELECT id FROM "Upload"
    WHERE status = 'FAILED' AND "cleanupPending" = true ORDER BY "updatedAt" LIMIT 20`);
  for (const row of failed.rows) await cleanupFailed(row.id);
}
