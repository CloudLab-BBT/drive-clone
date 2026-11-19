import { describe, expect, it } from 'vitest';
import { IdentityService } from './identity-service.ts';
import { ForbiddenError } from './errors.ts';

describe('Protección de raíz del usuario', () => {
  it('assertNotRoot rechaza cualquier intento sobre un recurso marcado como isRoot', () => {
    const service = new IdentityService({} as any);

    // Recurso normal no lanza error
    expect(() => service.assertNotRoot({ isRoot: false })).not.toThrow();

    // Recurso raíz lanza ForbiddenError
    expect(() => service.assertNotRoot({ isRoot: true })).toThrow(ForbiddenError);
    expect(() => service.assertNotRoot({ isRoot: true })).toThrow('La raíz está protegida');
  });
});
