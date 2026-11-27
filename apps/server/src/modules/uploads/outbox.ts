import { randomUUID } from 'node:crypto';
import { GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { PoolClient } from 'pg';
import { pool, sqs } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';

let queueUrl: string | undefined;
async function url() {
  if (!queueUrl)
    queueUrl = (await sqs.send(new GetQueueUrlCommand({ QueueName: config.queueName }))).QueueUrl;
  if (!queueUrl) throw new Error('Cola SQS no disponible');
  return queueUrl;
}

export async function enqueueUpload(client: PoolClient, id: string, availableAt?: Date) {
  await client.query(
    `INSERT INTO "Outbox" (id,"entityId",type,version,payload,"availableAt")
     VALUES ($1,$2,'UPLOAD',1,$3,COALESCE($4,clock_timestamp()))
     ON CONFLICT (type,"entityId",version) DO UPDATE SET
       "publishedAt" = NULL, "availableAt" = EXCLUDED."availableAt",
       "attemptId" = NULL, "leaseUntil" = NULL, "errorCode" = NULL`,
    [randomUUID(), id, JSON.stringify({ version: 1, type: 'UPLOAD', id }), availableAt ?? null],
  );
}

export async function wakeQueued(id: string, force = false): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ status: string; nextAttemptAt: Date | null }>(
      'SELECT status,"nextAttemptAt" FROM "Upload" WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (
      current.rows[0]?.status !== 'QUEUED' ||
      (current.rows[0].nextAttemptAt && current.rows[0].nextAttemptAt > new Date())
    ) {
      await client.query('COMMIT');
      return false;
    }
    const recent = await client.query<{ pending: boolean; recent: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM "Outbox" WHERE type = 'UPLOAD' AND "entityId" = $1
        AND "publishedAt" IS NULL) AS pending,
        EXISTS(SELECT 1 FROM "Outbox" WHERE type = 'UPLOAD' AND "entityId" = $1
        AND "publishedAt" > now() - interval '60 seconds') AS recent`,
      [id],
    );
    if (recent.rows[0].pending || (!force && recent.rows[0].recent)) {
      await client.query('COMMIT');
      return false;
    }
    await enqueueUpload(client, id);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileQueued(): Promise<void> {
  const rows = await pool.query<{ id: string }>(`SELECT id FROM "Upload"
    WHERE status = 'QUEUED' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
    ORDER BY "updatedAt" LIMIT 20`);
  for (const row of rows.rows) await wakeQueued(row.id);
}

export async function publishOutbox(): Promise<void> {
  const claim = randomUUID();
  const found = await pool.query<{ id: string; payload: unknown; publishAttempts: number }>(
    `UPDATE "Outbox" o SET "attemptId" = $1,
    "leaseUntil" = now() + interval '60 seconds', "publishAttempts" = "publishAttempts" + 1
    FROM (SELECT id FROM "Outbox" WHERE "publishedAt" IS NULL AND "availableAt" <= now()
      AND ("leaseUntil" IS NULL OR "leaseUntil" < now()) ORDER BY "createdAt" LIMIT 10
      FOR UPDATE SKIP LOCKED) next WHERE o.id = next.id
    RETURNING o.id,o.payload,o."publishAttempts"`,
    [claim],
  );
  for (const row of found.rows) {
    try {
      await sqs.send(
        new SendMessageCommand({ QueueUrl: await url(), MessageBody: JSON.stringify(row.payload) }),
      );
      await pool.query(
        `UPDATE "Outbox" SET "publishedAt" = now(), "attemptId" = NULL,
        "leaseUntil" = NULL, "errorCode" = NULL WHERE id = $1 AND "attemptId" = $2`,
        [row.id, claim],
      );
    } catch {
      const delay = row.publishAttempts === 1 ? 5 : row.publishAttempts === 2 ? 20 : 60;
      await pool.query(
        `UPDATE "Outbox" SET "attemptId" = NULL, "leaseUntil" = NULL,
        "errorCode" = 'PUBLISH_FAILED', "availableAt" = now() + ($3::int * interval '1 second')
        WHERE id = $1 AND "attemptId" = $2`,
        [row.id, claim, delay],
      );
    }
  }
}
