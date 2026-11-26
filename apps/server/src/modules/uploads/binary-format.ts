import { validateContainer as validateOfficeZip } from './zip-format.ts';
import { validateContainer as validateMediaContainer } from './media-format.ts';
import { validateContainer as validateImageContainer } from './image-format.ts';
import { validateContainer as validateOleContainer } from './ole-format.ts';

const starts = (data: Buffer, hex: string) =>
  data.subarray(0, hex.length / 2).toString('hex') === hex;
const text = (data: Buffer, offset: number, value: string) =>
  data.toString('ascii', offset, offset + value.length) === value;

export function validateSignature(extension: string, head: Buffer): boolean {
  switch (extension) {
    case 'png':
      return starts(head, '89504e470d0a1a0a');
    case 'jpg':
    case 'jpeg':
      return starts(head, 'ffd8ff');
    case 'webp':
      return text(head, 0, 'RIFF') && text(head, 8, 'WEBP');
    case 'pdf':
      return text(head, 0, '%PDF-');
    case 'wav':
      return text(head, 0, 'RIFF') && text(head, 8, 'WAVE');
    case 'ogg':
      return text(head, 0, 'OggS') && head.length >= 27 && head[4] === 0;
    case 'flac':
      return (
        text(head, 0, 'fLaC') &&
        head.length >= 42 &&
        head[4] === 0x80 &&
        head.readUIntBE(5, 3) === 34
      );
    case 'mp3':
      return validMp3(head);
    case 'mp4':
    case 'm4a':
    case 'mov':
      return text(head, 4, 'ftyp');
    case 'webm':
      return starts(head, '1a45dfa3') && head.includes(Buffer.from('webm'));
    case 'dng':
      return hasDngTag(head);
    case 'doc':
    case 'ppt':
    case 'xls':
      return validOle(head);
    case 'docx':
    case 'pptx':
    case 'xlsx':
    case 'odt':
    case 'ods':
    case 'odp':
      return starts(head, '504b0304');
    case 'txt':
    case 'csv':
      return !head.includes(0) && validUtf8(head);
    case 'raw':
      return true;
    default:
      return false;
  }
}

function validUtf8(bytes: Buffer) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
}

function validOle(head: Buffer) {
  return (
    starts(head, 'd0cf11e0a1b11ae1') &&
    head.length >= 512 &&
    head.readUInt16LE(28) === 0xfffe &&
    [9, 12].includes(head.readUInt16LE(30)) &&
    head.readUInt32LE(44) > 0
  );
}

function hasDngTag(head: Buffer) {
  if (!(starts(head, '49492a00') || starts(head, '4d4d002a')) || head.length < 16) return false;
  const little = head[0] === 0x49;
  const read16 = (offset: number) =>
    little ? head.readUInt16LE(offset) : head.readUInt16BE(offset);
  const read32 = (offset: number) =>
    little ? head.readUInt32LE(offset) : head.readUInt32BE(offset);
  const offset = read32(4);
  if (offset + 2 > head.length) return false;
  const count = Math.min(read16(offset), 64);
  for (let index = 0; index < count; index++) {
    const at = offset + 2 + index * 12;
    if (at + 12 > head.length) return false;
    if (read16(at) === 50706) return true;
  }
  return false;
}

export async function validateContainer(path: string, extension: string): Promise<boolean> {
  if (['docx', 'pptx', 'xlsx', 'odt', 'ods', 'odp'].includes(extension))
    return validateOfficeZip(path, extension);
  if (['doc', 'ppt', 'xls'].includes(extension)) return validateOleContainer(path, extension);
  if (['png', 'jpg', 'jpeg'].includes(extension)) return validateImageContainer(path, extension);
  if (['wav', 'webp', 'mp4', 'm4a', 'mov', 'pdf', 'mp3', 'ogg', 'flac'].includes(extension))
    return validateMediaContainer(path, extension);
  return true;
}

function validMp3(head: Buffer) {
  const frame = (offset: number) => {
    if (offset + 4 > head.length) return false;
    const word = head.readUInt32BE(offset);
    return (
      (word & 0xffe00000) >>> 0 === 0xffe00000 &&
      ((word >>> 19) & 3) !== 1 &&
      ((word >>> 17) & 3) !== 0 &&
      ((word >>> 12) & 15) > 0 &&
      ((word >>> 12) & 15) < 15 &&
      ((word >>> 10) & 3) !== 3
    );
  };
  if (frame(0)) return true;
  if (!text(head, 0, 'ID3') || head.length < 10) return false;
  const size =
    ((head[6] & 127) << 21) | ((head[7] & 127) << 14) | ((head[8] & 127) << 7) | (head[9] & 127);
  return size + 10 <= head.length && frame(size + 10);
}
