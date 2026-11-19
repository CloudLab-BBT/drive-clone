import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import {
  CreateQueueCommand, GetQueueAttributesCommand, GetQueueUrlCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { config } from './platform/config.ts';
import { closeClients, s3, sqs } from './platform/clients.ts';

async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.bucket }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw error;
    await s3.send(new CreateBucketCommand({ Bucket: config.bucket }));
  }
}

async function ensureQueue(name: string): Promise<string> {
  try {
    const result = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    if (!result.QueueUrl) throw new Error('La cola no devolvió URL');
    return result.QueueUrl;
  } catch (error) {
    const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (failure.name !== 'QueueDoesNotExist' && failure.name !== 'AWS.SimpleQueueService.NonExistentQueue' && failure.$metadata?.httpStatusCode !== 404) throw error;
    const result = await sqs.send(new CreateQueueCommand({ QueueName: name }));
    if (!result.QueueUrl) throw new Error('No se creó la cola');
    return result.QueueUrl;
  }
}

async function main(): Promise<void> {
  await ensureBucket();
  const dlqUrl = await ensureQueue(config.dlqName);
  const queueUrl = await ensureQueue(config.queueName);
  const attributes = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: dlqUrl, AttributeNames: ['QueueArn'],
  }));
  const arn = attributes.Attributes?.QueueArn;
  if (!arn) throw new Error('La DLQ no devolvió ARN');
  await sqs.send(new SetQueueAttributesCommand({ QueueUrl: queueUrl, Attributes: {
    VisibilityTimeout: '60',
    ReceiveMessageWaitTimeSeconds: '20',
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: 20 }),
  } }));
  process.stdout.write('Recursos S3/SQS verificados\n');
}

try { await main(); } finally { await closeClients(); }
