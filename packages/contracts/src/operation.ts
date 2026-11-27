import type { TSchema } from '@sinclair/typebox';

export interface Operation {
  id: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  summary: string;
  response?: TSchema;
  status: number;
  body?: TSchema;
  params?: TSchema;
  query?: TSchema;
  access: 'public' | 'session';
  csrf?: boolean;
  errors: number[];
  binary?: 'request' | 'response';
}
export const authErrors = [400, 401, 403, 429, 500, 503];
export const resourceErrors = [...authErrors, 404, 409];
