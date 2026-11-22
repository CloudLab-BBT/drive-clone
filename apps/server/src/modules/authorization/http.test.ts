import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { requireResourceAccess } from './http.ts';

describe('Control de acceso para rutas autenticadas', () => {
  it('rechaza si el guard de identidad todavía no identificó al usuario', async () => {
    const evaluate = vi.fn();
    await expect(requireResourceAccess({ evaluate })({}, randomUUID(), 'VIEW'))
      .rejects.toMatchObject({ statusCode: 401 });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('distingue recurso invisible, acción prohibida y autorización', async () => {
    const user = { id: randomUUID(), username: 'lector' };
    const id = randomUUID();
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ visible: false, allowed: false, effectivePermission: null })
      .mockResolvedValueOnce({ visible: true, allowed: false, effectivePermission: 'READ' })
      .mockResolvedValueOnce({ visible: true, allowed: true, effectivePermission: 'READ' });
    const requireAccess = requireResourceAccess({ evaluate });

    await expect(requireAccess({ user }, id, 'VIEW')).rejects.toMatchObject({ statusCode: 404 });
    await expect(requireAccess({ user }, id, 'DELETE')).rejects.toMatchObject({ statusCode: 403 });
    await expect(requireAccess({ user }, id, 'VIEW')).resolves.toMatchObject({ allowed: true });
    expect(evaluate).toHaveBeenCalledWith({ actorId: user.id, resourceId: id, action: 'VIEW' });
  });

  it('propaga errores de infraestructura al manejador de errores', async () => {
    const error = new Error('Error de conexión');
    const evaluate = vi.fn().mockRejectedValue(error);
    await expect(requireResourceAccess({ evaluate })(
      { user: { id: randomUUID(), username: 'lector' } }, randomUUID(), 'VIEW',
    )).rejects.toBe(error);
  });
});
