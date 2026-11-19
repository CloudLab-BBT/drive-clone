import argon2 from 'argon2';

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

export interface Argon2Options {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  type: number;
}

export const ARGON2_CONFIG: Argon2Options = {
  memoryCost: 19456, // 19 MiB en KiB
  timeCost: 2,       // 2 iteraciones
  parallelism: 1,    // 1 hilo
  type: argon2.argon2id,
};

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (typeof password !== 'string') {
    return { valid: false, error: 'La contraseña debe ser una cadena de texto' };
  }
  // Se valida longitud exacta sobre el string sin recortar
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { valid: false, error: `La contraseña no puede exceder ${PASSWORD_MAX_LENGTH} caracteres` };
  }
  return { valid: true };
}

export async function hashPassword(password: string): Promise<string> {
  const validation = validatePassword(password);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  return argon2.hash(password, {
    type: ARGON2_CONFIG.type,
    memoryCost: ARGON2_CONFIG.memoryCost,
    timeCost: ARGON2_CONFIG.timeCost,
    parallelism: ARGON2_CONFIG.parallelism,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
