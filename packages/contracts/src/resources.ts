import { Type } from '@sinclair/typebox';
import { Name, Permission, Timestamp, Uuid, Username } from './common.ts';
const resourceFields = { id: Uuid, ownerId: Uuid, name: Name,
  createdAt: Timestamp, updatedAt: Timestamp,
  effectivePermission: Type.Union([Type.Literal('OWNER'), Permission]) };
export const Resource = Type.Union([
  Type.Object({ ...resourceFields, kind: Type.Literal('FOLDER'), isRoot: Type.Literal(true),
    parentId: Type.Null() }, { additionalProperties: false }),
  Type.Object({ ...resourceFields, kind: Type.Literal('FOLDER'), isRoot: Type.Literal(false),
    parentId: Uuid }, { additionalProperties: false }),
  Type.Object({ ...resourceFields, kind: Type.Literal('FILE'), isRoot: Type.Literal(false),
    parentId: Uuid, size: Type.Integer({ minimum: 0 }), mimeType: Type.String({ minLength: 1 }) },
    { additionalProperties: false }),
], { description: 'Solo recursos ACTIVE y autorizados; no expone clave de objetos ni temporal.' });
export const ResourceResponse = Type.Object({ resource: Resource }, { additionalProperties: false });
export const ResourcePage = Type.Object({ items: Type.Array(Resource),
  nextCursor: Type.Union([Type.String(), Type.Null()]) }, { additionalProperties: false });
export const CreateFolder = Type.Object({ parentId: Uuid, name: Name }, { additionalProperties: false });
export const RenameResource = Type.Object({ name: Name }, { additionalProperties: false });
export const ShareInput = Type.Object({ username: Username, permission: Permission },
  { additionalProperties: false });
export const Share = Type.Object({ userId: Uuid, username: Username, permission: Permission,
  createdAt: Timestamp }, { additionalProperties: false });
export const ShareResponse = Type.Object({ share: Share }, { additionalProperties: false });
export const SharePage = Type.Object({ items: Type.Array(Share),
  nextCursor: Type.Union([Type.String(), Type.Null()]) }, { additionalProperties: false });
export const ShareParams = Type.Object({ id: Uuid, userId: Uuid }, { additionalProperties: false });
export const RevokeResponse = Type.Object({ userId: Uuid,
  remainingPermission: Type.Union([Permission, Type.Null()]) }, { additionalProperties: false });
export const DeleteQuery = Type.Object({ confirmRecursive: Type.Literal(true) },
  { additionalProperties: false });
export const Deletion = Type.Object({ id: Uuid, resourceId: Uuid,
  status: Type.Union((['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const).map(s => Type.Literal(s))),
  affectedResources: Type.Integer({ minimum: 1 }), processedResources: Type.Integer({ minimum: 0 }),
  createdAt: Timestamp, updatedAt: Timestamp,
  errorCode: Type.Optional(Type.Literal('CLEANUP_FAILED')) }, { additionalProperties: false });
export const DeletionResponse = Type.Object({ deletion: Deletion }, { additionalProperties: false });
