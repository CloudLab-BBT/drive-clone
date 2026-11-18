import { Type } from '@sinclair/typebox';
import { Name, Timestamp, Uuid } from './common.ts';
export const uploadStates = ['CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED',
  'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export const UploadState = Type.Union(uploadStates.map(s => Type.Literal(s)));
export const CreateUpload = Type.Object({ parentId: Uuid, name: Name,
  size: Type.Integer({ minimum: 0, maximum: 104857600 }) }, { additionalProperties: false });
export const Upload = Type.Object({ id: Uuid, resourceId: Uuid, status: UploadState,
  size: Type.Integer({ minimum: 0 }), receivedBytes: Type.Integer({ minimum: 0 }),
  attemptCount: Type.Integer({ minimum: 0, maximum: 3 }), createdAt: Timestamp, updatedAt: Timestamp,
  cleanupPending: Type.Boolean(), errorCode: Type.Optional(Type.Union(([
    'RECEIVE_INTERRUPTED', 'FORMAT_INVALID', 'SIZE_MISMATCH', 'EXPIRED', 'PROCESSING_FAILED',
  ] as const).map(s => Type.Literal(s)))) }, { additionalProperties: false });
export const UploadResponse = Type.Object({ upload: Upload }, { additionalProperties: false });
export const ActiveQuery = Type.Object({ active: Type.Literal(true) }, { additionalProperties: false });
export const ActiveUploads = Type.Object({ items: Type.Array(Upload, { maxItems: 10 }) },
  { additionalProperties: false });
export const UploadMessage = Type.Object({ version: Type.Literal(1), type: Type.Literal('UPLOAD'), id: Uuid },
  { additionalProperties: false });
export const DeleteMessage = Type.Object({ version: Type.Literal(1), type: Type.Literal('DELETE'), id: Uuid },
  { additionalProperties: false });
export const WorkerMessage = Type.Union([UploadMessage, DeleteMessage]);
