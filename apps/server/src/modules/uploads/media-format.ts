import { open } from 'node:fs/promises';

export async function validateContainer(path: string, extension: string): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    if (extension === 'mp4' || extension === 'm4a' || extension === 'mov')
      return await validateIso(file, size, extension);
    if (extension === 'wav' || extension === 'webp')
      return await validateRiff(file, size, extension);
    if (extension === 'pdf') return validatePdf(file, size);
    if (extension === 'ogg') return await validateOgg(file, size);
    if (extension === 'flac') return size >= 42;
    return size >= 4;
  } finally {
    await file.close();
  }
}

async function validatePdf(file: Awaited<ReturnType<typeof open>>, size: number) {
  const length = Math.min(size, 1024);
  const tail = Buffer.alloc(length);
  await file.read(tail, 0, length, size - length);
  return tail.includes(Buffer.from('%%EOF'));
}

async function validateOgg(file: Awaited<ReturnType<typeof open>>, size: number) {
  if (size < 27) return false;
  const header = Buffer.alloc(27);
  await file.read(header, 0, 27, 0);
  const count = header[26];
  if (27 + count > size) return false;
  const lacing = Buffer.alloc(count);
  await file.read(lacing, 0, count, 27);
  return 27 + count + lacing.reduce((sum, value) => sum + value, 0) <= size;
}

async function validateRiff(file: Awaited<ReturnType<typeof open>>, size: number, ext: string) {
  if (size < 20) return false;
  const header = Buffer.alloc(12);
  await file.read(header, 0, 12, 0);
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.readUInt32LE(4) + 8 > size) return false;
  const kind = header.toString('ascii', 8, 12);
  if (ext === 'webp') {
    const chunk = Buffer.alloc(8);
    await file.read(chunk, 0, 8, 12);
    return (
      kind === 'WEBP' &&
      chunk.toString('ascii', 0, 4) !== '' &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(chunk.toString('ascii', 0, 4)) &&
      chunk.readUInt32LE(4) > 0
    );
  }
  if (kind !== 'WAVE') return false;
  let offset = 12;
  let format = false;
  let data = false;
  while (offset + 8 <= size && (!format || !data)) {
    const chunk = Buffer.alloc(8);
    await file.read(chunk, 0, 8, offset);
    const name = chunk.toString('ascii', 0, 4);
    const length = chunk.readUInt32LE(4);
    if (length > size - offset - 8) return false;
    if (name === 'fmt ' && length >= 16) format = true;
    if (name === 'data') data = true;
    offset += 8 + length + (length % 2);
  }
  return format && data;
}

async function validateIso(file: Awaited<ReturnType<typeof open>>, size: number, ext: string) {
  if (size < 16) return false;
  const header = Buffer.alloc(16);
  await file.read(header, 0, 16, 0);
  const boxSize = header.readUInt32BE(0);
  if (
    header.toString('ascii', 4, 8) !== 'ftyp' ||
    boxSize < 16 ||
    (boxSize !== 1 && boxSize > size)
  )
    return false;
  const brand = header.toString('ascii', 8, 12);
  if (ext === 'm4a') return /^(M4A\x20|M4B\x20|mp42|isom)$/.test(brand);
  if (ext === 'mov') return /^(qt\x20\x20|isom|mp42)$/.test(brand);
  return true;
}
