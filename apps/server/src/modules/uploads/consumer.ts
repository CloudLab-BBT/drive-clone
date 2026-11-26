import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { sqs } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { processUpload } from './process.ts';
import { observe, parseUpload } from './queue-observation.ts';

let queueUrl: string | undefined;
async function url() {
  if (!queueUrl)
    queueUrl = (await sqs.send(new GetQueueUrlCommand({ QueueName: config.queueName }))).QueueUrl;
  if (!queueUrl) throw new Error('Cola SQS no disponible');
  return queueUrl;
}

export async function consumeQueue(): Promise<void> {
  const response = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: await url(),
      WaitTimeSeconds: 20,
      VisibilityTimeout: 60,
      MaxNumberOfMessages: 1,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }),
  );
  for (const message of response.Messages ?? []) {
    const id = parseUpload(message.Body ?? '');
    await observe(message, 'MAIN', id, id ? 'RECEIVED' : 'INVALID');
    if (!id) continue;
    let acknowledged = false;
    try {
      acknowledged = await processUpload(id, async () => {
        await sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: await url(),
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: 60,
          }),
        );
      });
    } catch {
      /* La observación persiste y SQS reentregará. */
    }
    if (acknowledged && message.ReceiptHandle) {
      await sqs.send(
        new DeleteMessageCommand({ QueueUrl: await url(), ReceiptHandle: message.ReceiptHandle }),
      );
      await observe(message, 'MAIN', id, 'ACKED');
    } else await observe(message, 'MAIN', id, 'RETRY');
  }
}
