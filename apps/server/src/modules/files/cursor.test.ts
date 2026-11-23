import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.ts';

const boundary = { id: '35d2017d-d65d-461e-b268-61db8cf7375f',
  createdAt: '2026-11-23T12:00:00.123456Z' };

describe('cursor O07', () => {
  it('conserva la precisión y limita el ámbito', () => {
    const value = encodeCursor(boundary, 'children:folder')!;
    expect(decodeCursor(value, 'children:folder')).toEqual(boundary);
    expect(() => decodeCursor(value, 'shared:actor')).toThrow('Cursor inválido');
  });

  it('rechaza datos malformados y límites excesivos', () => {
    expect(decodeCursor(undefined, 'shared:actor')).toBeUndefined();
    expect(encodeCursor(null, 'shared:actor')).toBeNull();
    for (const value of ['!!!', 'a'.repeat(513), Buffer.from(JSON.stringify({
      v: 1, ...boundary, scope: 'shared:actor', extra: true,
    })).toString('base64url')])
      expect(() => decodeCursor(value, 'shared:actor')).toThrow('Cursor inválido');
  });
});
