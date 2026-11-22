import { describe, expect, it } from 'vitest';
import { decide, type EffectivePermission, type Input, type VisibleResource } from './policy.ts';

const actions: Input['action'][] = [
  'VIEW', 'LIST_CHILDREN', 'DOWNLOAD', 'RENAME', 'DELETE', 'MANAGE_SHARES', 'CREATE_CHILD',
];
const resource: VisibleResource = {
  id: 'f0000000-0000-4000-8000-000000000001',
  kind: 'FOLDER',
  isRoot: false,
  cursorCreatedAt: '2026-11-22T00:00:00.000000Z',
  effectivePermission: 'OWNER',
};

describe('Matriz de autorización de recursos', () => {
  it.each<[EffectivePermission, boolean[]]>([
    ['OWNER', [true, true, true, true, true, true, true]],
    ['READ', [true, true, true, false, false, false, false]],
    ['EDIT', [true, true, true, true, true, false, false]],
  ])('aplica todos los permisos de %s', (effectivePermission, expected) => {
    expect(actions.map(action => decide({ ...resource, effectivePermission }, action))).toEqual(
      expected.map(allowed => ({ visible: true, allowed, effectivePermission })),
    );
  });

  it('deniega todas las acciones para recursos no visibles', () => {
    for (const action of actions) {
      expect(decide(undefined, action)).toEqual({
        visible: false, allowed: false, effectivePermission: null,
      });
    }
  });

  it('protege la raíz y permite crear dentro de la raíz propia', () => {
    expect(actions.map(action => decide({ ...resource, isRoot: true }, action).allowed))
      .toEqual([true, true, true, false, false, false, true]);
  });
});
