import { describe, expect, it } from 'vitest';
import {
  ARGON2_CONFIG,
  hashPassword,
  validatePassword,
  verifyPassword,
} from './password.ts';

describe('Política de contraseñas y hashing con Argon2id', () => {
  it('valida límites exactos de longitud (15 y 128 caracteres)', () => {
    // Límite inferior: 15 caracteres
    const pass15 = 'a'.repeat(15);
    expect(validatePassword(pass15).valid).toBe(true);

    // Límite superior: 128 caracteres
    const pass128 = 'a'.repeat(128);
    expect(validatePassword(pass128).valid).toBe(true);

    // Rechazo en 14 caracteres
    const pass14 = 'a'.repeat(14);
    expect(validatePassword(pass14).valid).toBe(false);

    // Rechazo en 129 caracteres
    const pass129 = 'a'.repeat(129);
    expect(validatePassword(pass129).valid).toBe(false);
  });

  it('permite frases de paso con espacios y caracteres variados sin reglas artificiales', () => {
    const passphrase1 = 'correct horse battery staple';
    expect(validatePassword(passphrase1).valid).toBe(true);

    const passphrase2 = 'esta es una frase de paso valida con espacios';
    expect(validatePassword(passphrase2).valid).toBe(true);

    const passphraseSimple = 'sololetrasminusculaslargas';
    expect(validatePassword(passphraseSimple).valid).toBe(true);
  });

  it('genera hash con Argon2id configurado según especificación (19 MiB, 2 iteraciones, 1 hilo)', async () => {
    expect(ARGON2_CONFIG.memoryCost).toBe(19456); // 19 MiB
    expect(ARGON2_CONFIG.timeCost).toBe(2);
    expect(ARGON2_CONFIG.parallelism).toBe(1);

    const password = 'frase de paso secreta 123';
    const hash = await hashPassword(password);

    // El formato del hash de Argon2id incluye los parámetros
    expect(hash).toContain('$argon2id$');
    expect(hash).toContain('m=19456,t=2,p=1');

    const isValid = await verifyPassword(hash, password);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPassword(hash, 'contraseña incorrecta 123');
    expect(isInvalid).toBe(false);
  });
});
