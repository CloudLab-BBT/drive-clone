import { describe, expect, it } from 'vitest';
import { normalizeUsername, validateUsername } from './username.ts';

describe('Validación y normalización de username', () => {
  it('acepta usernames válidos en límites de longitud (3 y 32 caracteres)', () => {
    // Límite inferior: 3 caracteres
    expect(validateUsername('abc').valid).toBe(true);
    expect(validateUsername('a12').valid).toBe(true);
    expect(validateUsername('a_b').valid).toBe(true);
    expect(validateUsername('a-c').valid).toBe(true);

    // Límite superior: 32 caracteres
    const user32 = 'a' + 'x'.repeat(31);
    expect(user32.length).toBe(32);
    expect(validateUsername(user32).valid).toBe(true);
  });

  it('rechaza usernames fuera de límites (2 y 33 caracteres)', () => {
    // Menor a 3
    expect(validateUsername('ab').valid).toBe(false);
    expect(validateUsername('a').valid).toBe(false);
    expect(validateUsername('').valid).toBe(false);

    // Mayor a 32
    const user33 = 'a' + 'x'.repeat(32);
    expect(user33.length).toBe(33);
    expect(validateUsername(user33).valid).toBe(false);
  });

  it('rechaza usernames que no inician con letra ASCII', () => {
    expect(validateUsername('1abc').valid).toBe(false);
    expect(validateUsername('-abc').valid).toBe(false);
    expect(validateUsername('_abc').valid).toBe(false);
    expect(validateUsername('.abc').valid).toBe(false);
  });

  it('rechaza caracteres no ASCII, acentos y símbolos especiales no permitidos', () => {
    expect(validateUsername('usuário').valid).toBe(false);
    expect(validateUsername('user@name').valid).toBe(false);
    expect(validateUsername('user.name').valid).toBe(false);
    expect(validateUsername('user name').valid).toBe(false);
    expect(validateUsername('ñandú').valid).toBe(false);
  });

  it('normaliza siempre a minúsculas y elimina espacios circundantes', () => {
    expect(normalizeUsername('  UsuarioAdmin  ')).toBe('usuarioadmin');
    const result = validateUsername('  AdminUser  ');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('adminuser');
  });
});
