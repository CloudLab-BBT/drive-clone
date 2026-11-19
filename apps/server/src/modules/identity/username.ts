export const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

export function normalizeUsername(username: string): string {
  if (typeof username !== 'string') return '';
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): { valid: boolean; normalized?: string; error?: string } {
  if (typeof username !== 'string') {
    return { valid: false, error: 'El nombre de usuario debe ser una cadena de texto' };
  }

  const normalized = normalizeUsername(username);

  if (normalized.length < USERNAME_MIN_LENGTH) {
    return { valid: false, error: `El nombre de usuario debe tener al menos ${USERNAME_MIN_LENGTH} caracteres` };
  }

  if (normalized.length > USERNAME_MAX_LENGTH) {
    return { valid: false, error: `El nombre de usuario no puede superar los ${USERNAME_MAX_LENGTH} caracteres` };
  }

  // Verificar que es ASCII y coincide con la estructura exigida
  if (!USERNAME_REGEX.test(normalized)) {
    return {
      valid: false,
      error: 'El nombre de usuario debe comenzar con una letra y contener únicamente letras ASCII, números, guion o guion bajo',
    };
  }

  return { valid: true, normalized };
}
