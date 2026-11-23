import { InvalidInputError } from '../identity/errors.ts';
import type { PageBoundary } from '../authorization/service.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function decodeCursor(value: unknown, scope: string): PageBoundary | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > 512)
    throw new InvalidInputError('Cursor inválido');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (parsed.v !== 1 || parsed.scope !== scope || typeof parsed.id !== 'string' ||
      !uuid.test(parsed.id) || typeof parsed.createdAt !== 'string' ||
      !timestamp.test(parsed.createdAt) || !Number.isFinite(Date.parse(parsed.createdAt)) ||
      Object.keys(parsed).sort().join(',') !== 'createdAt,id,scope,v')
      throw new Error('Cursor inválido');
    return { id: parsed.id, createdAt: parsed.createdAt };
  } catch { throw new InvalidInputError('Cursor inválido'); }
}

export function encodeCursor(boundary: PageBoundary | null, scope: string): string | null {
  return boundary ? Buffer.from(JSON.stringify({ v: 1, ...boundary, scope })).toString('base64url') : null;
}
