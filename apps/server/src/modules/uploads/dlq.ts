import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { pool, sqs } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { wakeQueued } from './outbox.ts';
import { observe, parseUpload } from './queue-observation.ts';

let dlqUrl: string | undefined;
async function url() {
  if (!dlqUrl)
    dlqUrl = (await sqs.send(new GetQueueUrlCommand({ QueueName: config.dlqName }))).QueueUrl;
  if (!dlqUrl) throw new Error('DLQ no disponible');
  return dlqUrl;
}

export async function reconcileDlq(): Promise<void> {
  const response = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: await url(),
      WaitTimeSeconds: 5,
      VisibilityTimeout: 30,
      MaxNumberOfMessages: 10,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }),
  );
  for (const message of response.Messages ?? []) {
    const id = parseUpload(message.Body ?? '');
    let outcome = 'INVALID';
    if (id) {
      const state = await pool.query<{ status: string }>(
        'SELECT status FROM "Upload" WHERE id = $1',
        [id],
      );
      if (state.rows[0]?.status === 'QUEUED') {
        outcome = (await wakeQueued(id, true)) ? 'RECOVERED' : 'DEFERRED';
      } else if (
        ['CREATED', 'RECEIVING', 'PROCESSING', 'CANCEL_REQUESTED'].includes(
          state.rows[0]?.status ?? '',
        )
      ) {
        outcome = 'ACTIVE';
      } else outcome = state.rows[0] ? 'TERMINAL' : 'INVALID';
    }
    await observe(message, 'DLQ', id, outcome);
    if (message.ReceiptHandle)
      await sqs.send(
        new DeleteMessageCommand({ QueueUrl: await url(), ReceiptHandle: message.ReceiptHandle }),
      );
  }
}
