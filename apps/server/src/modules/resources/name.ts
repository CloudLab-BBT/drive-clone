import { InvalidInputError } from '../identity/errors.ts';

export function normalizeResourceName(value: unknown) {
  if (typeof value !== 'string') throw new InvalidInputError('Nombre inválido');
  const name = value.normalize('NFC').trim();
  if (
    !name ||
    [...name].length > 120 ||
    name === '.' ||
    name === '..' ||
    /[\p{Cc}\p{Cf}\\/]/u.test(name)
  ) {
    throw new InvalidInputError('Nombre inválido');
  }
  return { name, nameKey: name.toLowerCase() };
}
