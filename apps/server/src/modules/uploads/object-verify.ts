import { createHash } from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';

export async function verifyObject(
  key: string,
  size: number,
  sha256: string,
): Promise<'VALID' | 'MISSING' | 'CORRUPT'> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    const hash = createHash('sha256');
    let bytes = 0;
    if (!response.Body) return 'CORRUPT';
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    return bytes === size && hash.digest('hex') === sha256 ? 'VALID' : 'CORRUPT';
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name;
    if (name === 'NoSuchKey' || (name === 'NotFound' && status === 404)) return 'MISSING';
    throw error;
  }
}
