import { open } from 'node:fs/promises';
import { hasChain, readChain, readFat } from './ole-chains.ts';

const signature = 'd0cf11e0a1b11ae1';
const end = 0xfffffffe;
const maxDirectory = 1024 * 1024;
const names: Record<string, string[]> = {
  doc: ['WordDocument'],
  ppt: ['PowerPoint Document'],
  xls: ['Workbook', 'Book'],
};

export async function validateContainer(path: string, extension: string) {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    const header = Buffer.alloc(512);
    await file.read(header, 0, header.length, 0);
    const sectorSize = 1 << header.readUInt16LE(30);
    const miniSectorSize = 1 << header.readUInt16LE(32);
    const sectors = Math.floor(size / sectorSize) - 1;
    if (
      size < sectorSize * 4 ||
      header.toString('hex', 0, 8) !== signature ||
      header.readUInt16LE(28) !== 0xfffe ||
      ![512, 4096].includes(sectorSize) ||
      miniSectorSize !== 64
    )
      return false;
    const fat = await readFat(file, header, sectors, sectorSize);
    if (!fat || fat.length < sectors) return false;
    const directory = await readChain(
      file,
      header.readUInt32LE(48),
      fat,
      sectors,
      sectorSize,
      maxDirectory,
    );
    if (!directory) return false;
    return await validStreams(file, directory, header, fat, sectors, sectorSize, extension);
  } finally {
    await file.close();
  }
}

async function validStreams(
  file: Awaited<ReturnType<typeof open>>,
  directory: Buffer,
  header: Buffer,
  fat: number[],
  sectors: number,
  sectorSize: number,
  extension: string,
) {
  let root: { start: number; size: number } | undefined;
  let stream: { start: number; size: number } | undefined;
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const type = directory[offset + 66];
    const length = directory.readUInt16LE(offset + 64);
    if (length < 4 || length > 64 || length % 2) continue;
    const name = directory.toString('utf16le', offset, offset + length - 2);
    const entry = {
      start: directory.readUInt32LE(offset + 116),
      size: Number(directory.readBigUInt64LE(offset + 120)),
    };
    if (type === 5 && name === 'Root Entry') root = entry;
    if (type === 2 && names[extension]?.includes(name)) stream = entry;
  }
  if (!root || !stream || stream.size < 1 || stream.size > 100 * 1024 * 1024) return false;
  const cutoff = header.readUInt32LE(56);
  if (stream.size >= cutoff)
    return hasChain(stream.start, Math.ceil(stream.size / sectorSize), fat, sectors);
  if (!hasChain(root.start, Math.ceil(root.size / sectorSize), fat, sectors)) return false;
  return validMiniStream(file, header, root.size, stream, fat, sectors, sectorSize);
}

async function validMiniStream(
  file: Awaited<ReturnType<typeof open>>,
  header: Buffer,
  rootSize: number,
  stream: { start: number; size: number },
  fat: number[],
  sectors: number,
  sectorSize: number,
) {
  const miniSize = 64;
  if (stream.start * miniSize + stream.size > rootSize) return false;
  const count = header.readUInt32LE(64);
  const first = header.readUInt32LE(60);
  if (!count || count * sectorSize > maxDirectory) return false;
  const raw = await readChain(file, first, fat, sectors, sectorSize, count * sectorSize);
  if (!raw || raw.length < count * sectorSize) return false;
  const miniFat = Array.from({ length: raw.length / 4 }, (_, i) => raw.readUInt32LE(i * 4));
  const seen = new Set<number>();
  let current = stream.start;
  for (let index = 0; index < Math.ceil(stream.size / miniSize); index++) {
    if (current >= miniFat.length || seen.has(current)) return false;
    seen.add(current);
    current = miniFat[current];
  }
  return true;
}
