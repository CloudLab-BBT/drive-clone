import { randomUUID } from 'node:crypto';
import type { Message } from '@aws-sdk/client-sqs';
import { pool } from '../../platform/clients.ts';

export function parseWork(body: string): { id: string; type: 'UPLOAD' | 'DELETE' } | null {
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(',') !== 'id,type,version' ||
      record.version !== 1 ||
      (record.type !== 'UPLOAD' && record.type !== 'DELETE') ||
      typeof record.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.id)
    )
      return null;
    return { id: record.id, type: record.type };
  } catch {
    return null;
  }
}

export async function observe(
  message: Message,
  source: 'MAIN' | 'DLQ',
  uploadId: string | null,
  outcome: string,
): Promise<void> {
  const count = Math.max(1, Number(message.Attributes?.ApproximateReceiveCount) || 1);
  await pool.query(
    `INSERT INTO "QueueObservation"
    (id,"messageId","uploadId",source,"receiveCount",outcome)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (source,"messageId","receiveCount")
    DO UPDATE SET outcome = EXCLUDED.outcome`,
    [randomUUID(), message.MessageId ?? 'missing-id', uploadId, source, count, outcome],
  );
}
