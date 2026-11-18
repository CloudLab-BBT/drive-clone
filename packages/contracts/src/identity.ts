import { Type } from '@sinclair/typebox';
import { Uuid, Username } from './common.ts';
export const Credentials = Type.Object({ username: Username,
  password: Type.String({ minLength: 15, maxLength: 128, writeOnly: true }) },
  { additionalProperties: false });
export const User = Type.Object({ id: Uuid, username: Username, rootId: Uuid },
  { additionalProperties: false });
export const AuthResponse = Type.Object({ user: User }, { additionalProperties: false });
export const CsrfResponse = Type.Object({ csrfToken: Type.String({ minLength: 1 }) },
  { additionalProperties: false });
