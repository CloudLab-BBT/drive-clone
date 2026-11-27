import { describe, expect, it } from 'vitest';
import { normalizeResourceName } from './name.ts';

describe('nombres de recursos', () => {
  it('recorta, aplica NFC y conserva acentos en la clave', () => {
    expect(normalizeResourceName('  A\u0301rbol  ')).toEqual({ name: 'Árbol', nameKey: 'árbol' });
    const limit = '🌱'.repeat(120);
    expect(normalizeResourceName(limit).name).toBe(limit);
  });

  it.each([' ', '.', ' .. ', 'a/b', 'a\\b', 'a\u0000b', 'x'.repeat(121)])(
    'rechaza un nombre inválido',
    (name) => expect(() => normalizeResourceName(name)).toThrow('Nombre inválido'),
  );
});
