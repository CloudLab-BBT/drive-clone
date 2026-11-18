import { Type, type Static } from '@sinclair/typebox';
import { Permission, Uuid } from './common.ts';
export const ResourceAction = Type.Union(([
  'VIEW', 'LIST_CHILDREN', 'DOWNLOAD', 'RENAME', 'DELETE', 'MANAGE_SHARES', 'CREATE_CHILD',
] as const).map(action => Type.Literal(action)));
export const AuthorizationInput = Type.Object({ actorId: Uuid, resourceId: Uuid,
  action: ResourceAction }, { additionalProperties: false });
export const AuthorizationDecision = Type.Union([
  Type.Object({ visible: Type.Literal(false), allowed: Type.Literal(false),
    effectivePermission: Type.Null() }, { additionalProperties: false }),
  Type.Object({ visible: Type.Literal(true), allowed: Type.Boolean(),
    effectivePermission: Type.Union([Type.Literal('OWNER'), Permission]) }, { additionalProperties: false }),
]);
export interface ResourceAuthorization {
  evaluate(input: Static<typeof AuthorizationInput>): Promise<Static<typeof AuthorizationDecision>>;
}
