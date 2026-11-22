import { describe, expect, it } from 'vitest';
import { normalizeName, validateSignature, validateSize } from './validation.ts';

describe('validación de carga', () => {
  it('normaliza nombre y reconoce formato sin confiar en MIME del navegador', () => {
    expect(normalizeName('  Foto.PNG ').name).toBe('Foto.PNG');
    expect(normalizeName('Foto.PNG').nameKey).toBe('foto.png');
    expect(normalizeName('Foto.PNG').mimeType).toBe('image/png');
  });

  it('rechaza rutas, controles, formatos no admitidos y tamaños excesivos', () => {
    for (const name of ['../foto.png', 'carpeta/foto.png', 'foto\u0000.png', 'archivo.exe'])
      expect(() => normalizeName(name)).toThrow();
    expect(() => validateSize(100 * 1024 * 1024 + 1)).toThrow();
  });

  it('contrasta firmas de formatos identificables', () => {
    expect(validateSignature('png', Buffer.from('89504e470d0a1a0a', 'hex'))).toBe(true);
    expect(validateSignature('png', Buffer.from('%PDF-1.7'))).toBe(false);
    expect(validateSignature('pdf', Buffer.from('%PDF-1.7'))).toBe(true);
  });
});
