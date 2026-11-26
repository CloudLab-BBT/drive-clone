import { open } from 'node:fs/promises';

const sectorSize = 512;
const endOfChain = 0xfffffffe;
const fatSector = 0xfffffffd;
const names: Record<string, string[]> = {
  doc: ['WordDocument'],
  ppt: ['PowerPoint Document'],
  xls: ['Workbook', 'Book'],
};

export async function validateContainer(path: string, extension: string) {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    if (size < sectorSize * 4) return false;
    const header = Buffer.alloc(sectorSize);
    await file.read(header, 0, sectorSize, 0);
    if (
      header.toString('hex', 0, 8) !== 'd0cf11e0a1b11ae1' ||
      header.readUInt16LE(28) !== 0xfffe ||
      header.readUInt16LE(30) !== 9 ||
      header.readUInt16LE(26) !== 3 ||
      header.readUInt32LE(44) < 1
    )
      return false;
    const sectors = Math.floor(size / sectorSize) - 1;
    const directoryId = header.readUInt32LE(48);
    const fatId = header.readUInt32LE(76);
    if (directoryId >= sectors || fatId >= sectors) return false;
    const fat = Buffer.alloc(sectorSize);
    await file.read(fat, 0, sectorSize, (fatId + 1) * sectorSize);
    if (
      fat.readUInt32LE((fatId % 128) * 4) !== fatSector ||
      fat.readUInt32LE((directoryId % 128) * 4) === 0xffffffff
    )
      return false;
    const directory = Buffer.alloc(sectorSize);
    await file.read(directory, 0, sectorSize, (directoryId + 1) * sectorSize);
    for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
      const kind = directory[offset + 66];
      const nameLength = directory.readUInt16LE(offset + 64);
      if (kind !== 2 || nameLength < 4 || nameLength > 64 || nameLength % 2 !== 0) continue;
      const name = directory.toString('utf16le', offset, offset + nameLength - 2);
      if (!names[extension].includes(name)) continue;
      const start = directory.readUInt32LE(offset + 116);
      const streamSize = Number(directory.readBigUInt64LE(offset + 120));
      return start < sectors && streamSize >= 4096 && (start + 1) * sectorSize + streamSize <= size;
    }
    return false;
  } finally {
    await file.close();
  }
}
