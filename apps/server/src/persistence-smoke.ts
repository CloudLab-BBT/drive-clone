import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { GetQueueUrlCommand, ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { config } from './platform/config.ts';
import { closeClients, s3, sqs } from './platform/clients.ts';

const marker = join(config.tempDir, 'o02-persistence-smoke.json');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function main(): Promise<void> {
  const mode = process.argv[2];
  const queue = await sqs.send(new GetQueueUrlCommand({ QueueName: config.dlqName }));
  if (!queue.QueueUrl) throw new Error('DLQ no disponible');
  if (mode === 'seed') {
    const key = `o02-smoke/${randomUUID()}`;
    const body = `O02:${key}`;
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body }));
    const sent = await sqs.send(new SendMessageCommand({ QueueUrl: queue.QueueUrl, MessageBody: body }));
    if (!sent.MessageId) throw new Error('Mensaje sin identificador');
    await writeFile(marker, JSON.stringify({ key, body, sha256: hash(body), messageId: sent.MessageId }));
    process.stdout.write(`Semilla persistente creada: ${key}\n`);
  } else if (mode === 'verify') {
    const expected = JSON.parse(await readFile(marker, 'utf8')) as {
      key: string; body: string; sha256: string; messageId: string;
    };
    const object = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: expected.key }));
    const content = await object.Body?.transformToString();
    if (content === undefined || hash(content) !== expected.sha256) throw new Error('Objeto distinto tras reinicio');
    const received = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queue.QueueUrl, MaxNumberOfMessages: 10 }));
    if (!received.Messages?.some((message) => message.MessageId === expected.messageId && message.Body === expected.body)) {
      throw new Error('Mensaje no recuperado tras reinicio');
    }
    process.stdout.write(`Objeto y mensaje persistentes verificados: ${expected.key}\n`);
  } else {
    throw new Error('Uso: node src/persistence-smoke.ts seed|verify');
  }
}

try { await main(); } finally { await closeClients(); }
