import { open } from 'node:fs/promises';
import { inspectZipDirectory } from './zip-inspector.ts';

const maxMetadata = 1024 * 1024;
const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

export async function validateContainer(path: string, extension: string): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    if (size < 22) return false;
    const tailSize = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailSize);
    await file.read(tail, 0, tailSize, size - tailSize);
    const eocd = tail.lastIndexOf(eocdSignature);
    if (eocd < 0 || eocd + 22 > tail.length) return false;
    const comment = tail.readUInt16LE(eocd + 20);
    if (
      eocd + 22 + comment !== tail.length ||
      tail.readUInt16LE(eocd + 4) ||
      tail.readUInt16LE(eocd + 6)
    )
      return false;
    const count = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryStart = tail.readUInt32LE(eocd + 16);
    const absoluteEnd = size - tailSize + eocd;
    if (
      !count ||
      count > 1000 ||
      count !== tail.readUInt16LE(eocd + 8) ||
      directorySize > maxMetadata ||
      directoryStart + directorySize !== absoluteEnd ||
      tailSize + directorySize > maxMetadata
    )
      return false;
    const directory = Buffer.alloc(directorySize);
    await file.read(directory, 0, directorySize, directoryStart);
    return await inspectZipDirectory(
      file,
      directory,
      count,
      directoryStart,
      tailSize + directorySize,
      extension,
    );
  } finally {
    await file.close();
  }
}
