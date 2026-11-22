import { extname } from 'node:path';
import { AppError, InvalidInputError } from '../identity/errors.ts';
import { open } from 'node:fs/promises';

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
const formats: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  raw: 'application/octet-stream', dng: 'image/x-adobe-dng', mp3: 'audio/mpeg',
  wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', csv: 'text/csv',
};

export function normalizeName(value: unknown): { name: string; nameKey: string; mimeType: string } {
  if (typeof value !== 'string') throw new InvalidInputError('Nombre inválido');
  const name = value.normalize('NFC').trim();
  if (!name || [...name].length > 120 || name === '.' || name === '..' ||
      /[\p{Cc}\p{Cf}\\/]/u.test(name)) throw new InvalidInputError('Nombre inválido');
  const extension = extname(name).slice(1).toLowerCase();
  const mimeType = formats[extension];
  if (!mimeType) throw new AppError('FORMAT_INVALID', 'Formato no admitido', 415);
  return { name, nameKey: name.toLocaleLowerCase('und'), mimeType };
}

export function validateSize(size: unknown): number {
  if (!Number.isSafeInteger(size) || Number(size) < 0) throw new InvalidInputError('Tamaño inválido');
  if (Number(size) > MAX_FILE_BYTES) throw new AppError('FILE_TOO_LARGE', 'Archivo demasiado grande', 413);
  return Number(size);
}

export function validateSignature(extension: string, head: Buffer): boolean {
  const prefix = (hex: string) => head.subarray(0, hex.length / 2).toString('hex') === hex;
  const ascii = (offset: number, value: string) => head.toString('ascii', offset, offset + value.length) === value;
  switch (extension) {
    case 'png': return prefix('89504e470d0a1a0a');
    case 'jpg': case 'jpeg': return prefix('ffd8ff');
    case 'webp': return ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case 'pdf': return ascii(0, '%PDF-');
    case 'wav': return ascii(0, 'RIFF') && ascii(8, 'WAVE');
    case 'ogg': return ascii(0, 'OggS');
    case 'flac': return ascii(0, 'fLaC');
    case 'mp3': return ascii(0, 'ID3') || prefix('fffb') || prefix('fff3') || prefix('fff2');
    case 'mp4': case 'm4a': case 'mov': return ascii(4, 'ftyp');
    case 'webm': return prefix('1a45dfa3');
    case 'dng': return prefix('49492a00') || prefix('4d4d002a');
    case 'doc': case 'ppt': case 'xls': return prefix('d0cf11e0a1b11ae1');
    case 'docx': case 'pptx': case 'xlsx': case 'odt': case 'ods': case 'odp': return prefix('504b0304');
    case 'txt': case 'csv': return !head.includes(0) &&
      new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true }).length >= 0;
    case 'raw': return true;
    default: return false;
  }
}

export async function validateContainer(path: string, extension: string): Promise<boolean> {
  if (!['docx', 'pptx', 'xlsx', 'odt', 'ods', 'odp'].includes(extension)) return true;
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const tail = Buffer.alloc(Math.min(size, 65_557));
    await file.read(tail, 0, tail.length, size - tail.length);
    const marker = tail.lastIndexOf(Buffer.from('504b0506', 'hex'));
    if (marker < 0 || marker + 22 > tail.length) return false;
    const entries = tail.readUInt16LE(marker + 10);
    const directorySize = tail.readUInt32LE(marker + 12);
    const directoryOffset = tail.readUInt32LE(marker + 16);
    if (entries < 1 || entries > 10_000 || directorySize > 8 * 1024 * 1024 ||
        directoryOffset + directorySize > size) return false;
    const directory = Buffer.alloc(directorySize);
    await file.read(directory, 0, directorySize, directoryOffset);
    const names = new Set<string>();
    let offset = 0;
    for (let i = 0; i < entries; i++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) return false;
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const uncompressed = directory.readUInt32LE(offset + 24);
      if (uncompressed > 512 * 1024 * 1024 || offset + 46 + nameLength > directory.length) return false;
      const name = directory.toString('utf8', offset + 46, offset + 46 + nameLength);
      if (name.includes('..') || name.startsWith('/')) return false;
      names.add(name);
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (offset !== directory.length) return false;
    if (extension === 'docx') return names.has('[Content_Types].xml') && names.has('word/document.xml');
    if (extension === 'pptx') return names.has('[Content_Types].xml') && names.has('ppt/presentation.xml');
    if (extension === 'xlsx') return names.has('[Content_Types].xml') && names.has('xl/workbook.xml');
    return names.has('mimetype') && names.has('META-INF/manifest.xml');
  } finally { await file.close(); }
}
