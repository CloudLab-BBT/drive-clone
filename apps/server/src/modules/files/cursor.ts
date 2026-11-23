import { InvalidInputError } from '../identity/errors.ts';
import type { PageBoundary } from '../authorization/service.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function validTimestamp(value: string): boolean {
  if (!timestamp.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59;
}

export function decodeCursor(value: unknown, scope: string): PageBoundary | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > 512)
    throw new InvalidInputError('Cursor inválido');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (parsed.v !== 1 || parsed.scope !== scope || typeof parsed.id !== 'string' ||
      !uuid.test(parsed.id) || typeof parsed.createdAt !== 'string' ||
      !validTimestamp(parsed.createdAt) ||
      Object.keys(parsed).sort().join(',') !== 'createdAt,id,scope,v')
      throw new Error('Cursor inválido');
    return { id: parsed.id, createdAt: parsed.createdAt };
  } catch { throw new InvalidInputError('Cursor inválido'); }
}

export function encodeCursor(boundary: PageBoundary | null, scope: string): string | null {
  return boundary ? Buffer.from(JSON.stringify({ v: 1, ...boundary, scope })).toString('base64url') : null;
}
