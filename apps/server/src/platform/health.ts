import { access, constants, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { config } from './config.ts';
import { pool, s3, sqs } from './clients.ts';

export async function bounded(name: string, check: () => Promise<unknown>, timeoutMs = 3000): Promise<[string, boolean]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    return [name, true];
  } catch {
    return [name, false];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readiness(): Promise<{ ready: boolean; checks: Record<string, boolean> }> {
  const entries = await Promise.all([
    bounded('database', async () => { await pool.query('SELECT 1'); }),
    bounded('bucket', async () => { await s3.send(new HeadBucketCommand({ Bucket: config.bucket })); }),
    bounded('queue', async () => { await sqs.send(new GetQueueUrlCommand({ QueueName: config.queueName })); }),
    bounded('dlq', async () => { await sqs.send(new GetQueueUrlCommand({ QueueName: config.dlqName })); }),
    bounded('temporary', async () => {
      await mkdir(config.tempDir, { recursive: true });
      await access(config.tempDir, constants.R_OK | constants.W_OK);
      const path = join(config.tempDir, `.health-${randomUUID()}`);
      await writeFile(path, '', { flag: 'wx' });
      await unlink(path);
    }),
  ]);
  const checks = Object.fromEntries(entries);
  return { ready: entries.every(([, ok]) => ok), checks };
}
