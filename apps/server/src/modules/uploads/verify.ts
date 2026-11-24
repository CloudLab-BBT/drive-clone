import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function verifyTemp(
  path: string,
  expectedSize: number,
  expectedHash: string,
): Promise<void> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  if (bytes !== expectedSize || hash.digest('hex') !== expectedHash)
    throw new Error('Temporal alterado');
}
