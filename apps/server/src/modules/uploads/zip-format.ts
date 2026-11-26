import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

export async function validateContainer(path: string, ext: string): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    const tailSize = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailSize);
    await file.read(tail, 0, tailSize, size - tailSize);
    const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0 || end + 22 > tail.length) return false;
    const count = tail.readUInt16LE(end + 10);
    const length = tail.readUInt32LE(end + 12);
    const start = tail.readUInt32LE(end + 16);
    if (!count || count > 1000 || length > 1024 * 1024 || start + length > size) return false;
    const directory = Buffer.alloc(length);
    await file.read(directory, 0, length, start);
    const contents = new Map<string, Buffer>();
    const names = new Set<string>();
    let offset = 0;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > length || directory.readUInt32LE(offset) !== 0x02014b50) return false;
      const entry = parseEntry(directory, offset);
      if (!entry || entry.name.includes('..') || entry.raw > 1024 * 1024) return false;
      names.add(entry.name);
      if (['mimetype', '[Content_Types].xml'].includes(entry.name)) {
        const value = await readZipEntry(file, entry);
        if (!value) return false;
        contents.set(entry.name, value);
      }
      offset += entry.next;
    }
    return offset === length && matches(ext, names, contents);
  } finally {
    await file.close();
  }
}

function parseEntry(dir: Buffer, at: number) {
  const nameLength = dir.readUInt16LE(at + 28);
  const extra = dir.readUInt16LE(at + 30);
  const comment = dir.readUInt16LE(at + 32);
  const next = 46 + nameLength + extra + comment;
  if (at + next > dir.length) return null;
  return {
    name: dir.toString('utf8', at + 46, at + 46 + nameLength),
    method: dir.readUInt16LE(at + 10),
    packed: dir.readUInt32LE(at + 20),
    raw: dir.readUInt32LE(at + 24),
    local: dir.readUInt32LE(at + 42),
    next,
  };
}

async function readZipEntry(
  file: Awaited<ReturnType<typeof open>>,
  entry: NonNullable<ReturnType<typeof parseEntry>>,
) {
  if (entry.packed > 1024 * 1024 || entry.local + 30 > (await file.stat()).size) return null;
  const header = Buffer.alloc(30);
  await file.read(header, 0, 30, entry.local);
  if (header.readUInt32LE(0) !== 0x04034b50) return null;
  const dataAt = entry.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (dataAt + entry.packed > (await file.stat()).size) return null;
  const packed = Buffer.alloc(entry.packed);
  await file.read(packed, 0, packed.length, dataAt);
  try {
    const data =
      entry.method === 0
        ? packed
        : entry.method === 8
          ? inflateRawSync(packed, { maxOutputLength: 1024 * 1024 })
          : null;
    return data && data.length === entry.raw ? data : null;
  } catch {
    return null;
  }
}

function matches(ext: string, names: Set<string>, content: Map<string, Buffer>) {
  const required =
    ext === 'docx'
      ? 'word/document.xml'
      : ext === 'pptx'
        ? 'ppt/presentation.xml'
        : ext === 'xlsx'
          ? 'xl/workbook.xml'
          : 'META-INF/manifest.xml';
  if (!names.has(required)) return false;
  if (ext.startsWith('o')) {
    const mime = {
      odt: 'application/vnd.oasis.opendocument.text',
      ods: 'application/vnd.oasis.opendocument.spreadsheet',
      odp: 'application/vnd.oasis.opendocument.presentation',
    }[ext];
    return content.get('mimetype')?.toString() === mime;
  }
  const xml = content.get('[Content_Types].xml')?.toString() ?? '';
  return xml.includes(
    ext === 'docx' ? 'wordprocessingml' : ext === 'pptx' ? 'presentationml' : 'spreadsheetml',
  );
}
