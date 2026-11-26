import { inflateRawSync } from 'node:zlib';
import type { FileHandle } from 'node:fs/promises';
import { parseEntry, safeEntry, type Entry } from './zip-entry.ts';
import { validStructure } from './zip-structure.ts';

const maxMetadata = 1024 * 1024;
const maxContent = 10 * 1024 * 1024;

export async function inspectZipDirectory(
  file: FileHandle,
  dir: Buffer,
  count: number,
  directoryStart: number,
  metadata: number,
  ext: string,
) {
  const entries = new Map<string, Entry>();
  const inspected = new Map<string, Buffer>();
  let offset = 0;
  let declared = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > dir.length || dir.readUInt32LE(offset) !== 0x02014b50) return false;
    const entry = parseEntry(dir, offset);
    if (!entry || !safeEntry(entry) || entries.has(entry.name)) return false;
    const local = await validateLocal(file, entry, directoryStart, metadata);
    if (!local) return false;
    metadata += local.metadata;
    if (metadata > maxMetadata) return false;
    declared += entry.raw;
    if (declared > maxContent) return false;
    entries.set(entry.name, entry);
    offset += entry.next;
    if (
      [
        'mimetype',
        '[Content_Types].xml',
        '_rels/.rels',
        'word/document.xml',
        'ppt/presentation.xml',
        'xl/workbook.xml',
        'META-INF/manifest.xml',
      ].includes(entry.name)
    ) {
      const body = await readEntry(file, entry, local.dataAt);
      if (!body) return false;
      inspected.set(entry.name, body);
    }
  }
  return offset === dir.length && validStructure(ext, entries, inspected);
}

async function validateLocal(
  file: FileHandle,
  entry: Entry,
  directoryStart: number,
  metadata: number,
) {
  if (entry.local + 30 > directoryStart) return null;
  const head = Buffer.alloc(30);
  await file.read(head, 0, head.length, entry.local);
  const nameLength = head.readUInt16LE(26);
  const extraLength = head.readUInt16LE(28);
  const metadataBytes = 30 + nameLength + extraLength;
  if (
    head.readUInt32LE(0) !== 0x04034b50 ||
    metadata + metadataBytes > maxMetadata ||
    head.readUInt16LE(6) !== entry.flags ||
    head.readUInt16LE(8) !== entry.method ||
    entry.local + metadataBytes + entry.packed > directoryStart
  )
    return null;
  const name = Buffer.alloc(nameLength);
  await file.read(name, 0, nameLength, entry.local + 30);
  if (name.toString('utf8') !== entry.name) return null;
  if (
    !(entry.flags & 8) &&
    (head.readUInt32LE(14) !== entry.crc ||
      head.readUInt32LE(18) !== entry.packed ||
      head.readUInt32LE(22) !== entry.raw)
  )
    return null;
  return { metadata: metadataBytes, dataAt: entry.local + metadataBytes };
}

async function readEntry(file: FileHandle, entry: Entry, dataAt: number) {
  if (entry.raw > maxContent) return null;
  const packed = Buffer.alloc(entry.packed);
  await file.read(packed, 0, packed.length, dataAt);
  try {
    const body =
      entry.method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: maxContent });
    if (body.length !== entry.raw || crc32(body) !== entry.crc) return null;
    return body;
  } catch {
    return null;
  }
}

function crc32(body: Buffer) {
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
