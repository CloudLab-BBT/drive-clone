import { Type } from '@sinclair/typebox';
export const Uuid = Type.String({ format: 'uuid' });
export const Timestamp = Type.String({ format: 'date-time' });
export const Name = Type.String({ minLength: 1, maxLength: 120,
  pattern: String.raw`^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f-\u009f]+$`,
  description: 'Normalizar NFC y trim antes de validar; comparar duplicados sin distinguir mayúsculas.' });
export const Username = Type.String({ minLength: 3, maxLength: 32,
  pattern: '^[A-Za-z][A-Za-z0-9_-]{2,31}$', description: 'Persistir en minúsculas.' });
export const Permission = Type.Union([Type.Literal('READ'), Type.Literal('EDIT')]);
export const ErrorCode = Type.Union(([
  'INVALID_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'RESOURCE_UNAVAILABLE', 'NAME_CONFLICT',
  'STATE_CONFLICT', 'QUOTA_EXCEEDED', 'DEPTH_EXCEEDED', 'UNSUPPORTED_FORMAT', 'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED', 'DEPENDENCY_UNAVAILABLE', 'CSRF_INVALID', 'INTERNAL_ERROR', 'USERNAME_TAKEN',
] as const).map(value => Type.Literal(value)));
export const ErrorResponse = Type.Object({ code: ErrorCode, message: Type.String(),
  requestId: Type.String({ minLength: 1 }), fields: Type.Optional(Type.Record(Type.String(),
    Type.Array(Type.String()))) }, { additionalProperties: false });
export const ResourceParams = Type.Object({ id: Uuid }, { additionalProperties: false });
export const PageQuery = Type.Object({ cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })) },
  { additionalProperties: false });
export const Health = Type.Object({ status: Type.Union([Type.Literal('ok'),
  Type.Literal('unavailable')]) }, { additionalProperties: false });
