import { extname } from 'node:path';
import { AppError, InvalidInputError } from '../identity/errors.ts';

import { normalizeResourceName } from '../resources/name.ts';

const formats: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  raw: 'application/octet-stream',
  dng: 'image/x-adobe-dng',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
};

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOADS_PER_USER = 10;
export const MAX_USER_BYTES = 1024 ** 3;

export function normalizeName(value: unknown): { name: string; nameKey: string; mimeType: string } {
  const { name, nameKey } = normalizeResourceName(value);
  const extension = extname(name).slice(1).toLowerCase();
  const mimeType = formats[extension];
  if (!mimeType) throw new AppError('UNSUPPORTED_FORMAT', 'Formato no admitido', 415);
  return { name, nameKey, mimeType };
}

export function validateSize(size: unknown): number {
  if (!Number.isSafeInteger(size) || Number(size) < 0)
    throw new InvalidInputError('Tamaño inválido');
  if (Number(size) > MAX_FILE_BYTES)
    throw new AppError('PAYLOAD_TOO_LARGE', 'Archivo demasiado grande', 413);
  return Number(size);
}
