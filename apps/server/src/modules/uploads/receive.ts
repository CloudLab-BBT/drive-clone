import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../identity/errors.ts';
import { config } from '../../platform/config.ts';
import { validateContainer, validateSignature } from './validation.ts';
import type { UploadRow } from './store.ts';

export async function receiveFile(stream: Readable, upload: UploadRow, name: string) {
  await mkdir(config.tempDir, { recursive: true });
  const key = randomUUID();
  const partial = join(config.tempDir, `${key}.part`);
  const complete = join(config.tempDir, `${key}.ready`);
  const hash = createHash('sha256');
  const extension = extname(name).slice(1).toLowerCase();
  const decoder = ['txt', 'csv'].includes(extension) ? new TextDecoder('utf-8', { fatal: true }) : null;
  let bytes = 0;
  let head = Buffer.alloc(0);
  const timeout = setTimeout(() => stream.destroy(new Error('Tiempo máximo de recepción agotado')), 600_000);
  const measure = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > Number(upload.expectedSize)) {
      callback(new AppError('FILE_TOO_LARGE', 'Contenido mayor que el reservado', 413));
      return;
    }
    if (head.length < 512) head = Buffer.concat([head, chunk.subarray(0, 512 - head.length)]);
    if (decoder) {
      try { decoder.decode(chunk, { stream: true }); }
      catch { callback(new AppError('FORMAT_INVALID', 'Texto UTF-8 inválido', 415)); return; }
    }
    hash.update(chunk);
    callback(null, chunk);
  } });
  try {
    await pipeline(stream, measure, createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
    try { decoder?.decode(); } catch { throw new AppError('FORMAT_INVALID', 'Texto UTF-8 inválido', 415); }
    if (bytes !== Number(upload.expectedSize)) throw new AppError('SIZE_MISMATCH', 'Tamaño recibido distinto del reservado', 409);
    let valid = false;
    try { valid = validateSignature(extension, head); } catch { valid = false; }
    if (!valid || !(await validateContainer(partial, extension)))
      throw new AppError('FORMAT_INVALID', 'Contenido no corresponde al formato', 415);
    await rename(partial, complete);
    return { tempKey: `${key}.ready`, bytes, sha256: hash.digest('hex') };
  } catch (error) {
    await rm(partial, { force: true });
    await rm(complete, { force: true });
    throw error;
  } finally { clearTimeout(timeout); }
}
