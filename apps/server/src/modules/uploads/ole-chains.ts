import type { FileHandle } from 'node:fs/promises';

const free = 0xffffffff;
const end = 0xfffffffe;
const fatMarker = 0xfffffffd;

export async function readFat(
  file: FileHandle,
  header: Buffer,
  sectors: number,
  sectorSize: number,
) {
  const count = header.readUInt32LE(44);
  if (!count || count > sectors) return null;
  const ids = Array.from({ length: 109 }, (_, i) => header.readUInt32LE(76 + i * 4)).filter(
    (id) => id !== free,
  );
  const seen = new Set<number>();
  let next = header.readUInt32LE(68);
  const difatCount = header.readUInt32LE(72);
  for (let index = 0; index < difatCount; index++) {
    if (next >= sectors || seen.has(next)) return null;
    seen.add(next);
    const data = Buffer.alloc(sectorSize);
    await file.read(data, 0, sectorSize, (next + 1) * sectorSize);
    for (let at = 0; at < sectorSize - 4; at += 4) {
      const id = data.readUInt32LE(at);
      if (id !== free) ids.push(id);
    }
    next = data.readUInt32LE(sectorSize - 4);
  }
  if (ids.length !== count || next !== end) return null;
  const fat = Buffer.alloc(count * sectorSize);
  for (let index = 0; index < count; index++) {
    const id = ids[index];
    if (id >= sectors || seen.has(id)) return null;
    seen.add(id);
    await file.read(fat, index * sectorSize, sectorSize, (id + 1) * sectorSize);
  }
  const entries = Array.from({ length: fat.length / 4 }, (_, i) => fat.readUInt32LE(i * 4));
  if (ids.some((id) => entries[id] !== fatMarker)) return null;
  return entries;
}

export async function readChain(
  file: FileHandle,
  start: number,
  fat: number[],
  sectors: number,
  sectorSize: number,
  maxBytes: number,
) {
  const chunks: Buffer[] = [];
  const seen = new Set<number>();
  let current = start;
  let length = 0;
  while (current !== end) {
    if (current >= sectors || seen.has(current) || length + sectorSize > maxBytes) return null;
    seen.add(current);
    const chunk = Buffer.alloc(sectorSize);
    await file.read(chunk, 0, sectorSize, (current + 1) * sectorSize);
    chunks.push(chunk);
    length += sectorSize;
    current = fat[current];
  }
  return Buffer.concat(chunks);
}

export function hasChain(start: number, needed: number, fat: number[], sectors: number) {
  const seen = new Set<number>();
  let current = start;
  for (let index = 0; index < needed; index++) {
    if (current >= sectors || seen.has(current)) return false;
    seen.add(current);
    current = fat[current];
  }
  return true;
}
