import type {
  AuthorizationDecision,
  AuthorizationInput,
  Static,
} from '@drive-clone/contracts';

export type Decision = Static<typeof AuthorizationDecision>;
export type Input = Static<typeof AuthorizationInput>;
export type EffectivePermission = NonNullable<Decision['effectivePermission']>;

export interface VisibleResource {
  id: string;
  kind: 'FILE' | 'FOLDER';
  isRoot: boolean;
  effectivePermission: EffectivePermission;
  cursorCreatedAt: string;
}

export const invisible: Decision = Object.freeze({
  visible: false, allowed: false, effectivePermission: null,
});

export function decide(resource: VisibleResource | undefined, action: Input['action']): Decision {
  if (!resource) return invisible;
  const { effectivePermission, isRoot } = resource;
  const owns = effectivePermission === 'OWNER';
  const edits = owns || effectivePermission === 'EDIT';

  // El caso de uso valida el tipo del recurso y sus demás precondiciones.
  const allowed: Record<Input['action'], boolean> = {
    VIEW: true,
    LIST_CHILDREN: true,
    DOWNLOAD: true,
    RENAME: !isRoot && edits,
    DELETE: !isRoot && edits,
    MANAGE_SHARES: !isRoot && owns,
    CREATE_CHILD: owns,
  };
  return { visible: true, allowed: allowed[action] === true, effectivePermission };
}
