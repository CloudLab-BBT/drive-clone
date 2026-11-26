import { open } from 'node:fs/promises';

export async function validateContainer(path: string, ext: string): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    return ext === 'png' ? await validatePng(file, size) : await validateJpeg(file, size);
  } finally {
    await file.close();
  }
}

async function validatePng(file: Awaited<ReturnType<typeof open>>, size: number) {
  if (size < 33) return false;
  const header = Buffer.alloc(33);
  await file.read(header, 0, header.length, 0);
  return (
    header.readUInt32BE(8) === 13 &&
    header.toString('ascii', 12, 16) === 'IHDR' &&
    header.readUInt32BE(16) > 0 &&
    header.readUInt32BE(20) > 0 &&
    [0, 2, 3, 4, 6].includes(header[25]) &&
    header[24] > 0
  );
}

async function validateJpeg(file: Awaited<ReturnType<typeof open>>, size: number) {
  if (size < 12) return false;
  let offset = 2;
  let frame = false;
  let scan = false;
  while (offset + 4 <= Math.min(size, 65_536)) {
    const marker = Buffer.alloc(4);
    await file.read(marker, 0, 4, offset);
    if (marker[0] !== 0xff) return false;
    const type = marker[1];
    if (type === 0xd9) return frame && scan;
    if (type === 0xda) {
      scan = true;
      break;
    }
    if (type === 0x00 || type === 0xff || type === 0xd8) return false;
    const length = marker.readUInt16BE(2);
    if (length < 2 || offset + 2 + length > size) return false;
    if (type >= 0xc0 && type <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(type)) {
      if (length < 8) return false;
      frame = true;
    }
    offset += 2 + length;
  }
  if (!frame || !scan) return false;
  const tail = Buffer.alloc(Math.min(size, 4096));
  await file.read(tail, 0, tail.length, size - tail.length);
  return tail.lastIndexOf(Buffer.from([0xff, 0xd9])) >= 0;
}
