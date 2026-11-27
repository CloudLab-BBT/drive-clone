import * as C from './common.ts';
import * as I from './identity.ts';
import { authErrors, type Operation } from './operation.ts';
import { deletionOperation, resourceOperations } from './resource-operations.ts';
import { transferOperations } from './transfer-operations.ts';

export type { Operation } from './operation.ts';

export const operations: Operation[] = [
  {
    id: 'getCsrf',
    method: 'get',
    path: '/auth/csrf',
    summary: 'Obtener sesión previa y token CSRF',
    response: I.CsrfResponse,
    status: 200,
    access: 'public',
    errors: [429, 500, 503],
  },
  {
    id: 'register',
    method: 'post',
    path: '/auth/register',
    summary: 'Registrar usuario y raíz',
    body: I.Credentials,
    response: I.AuthResponse,
    status: 201,
    access: 'public',
    csrf: true,
    errors: [400, 403, 409, 429, 500, 503],
  },
  {
    id: 'login',
    method: 'post',
    path: '/auth/login',
    summary: 'Autenticar y regenerar sesión',
    body: I.Credentials,
    response: I.AuthResponse,
    status: 200,
    access: 'public',
    csrf: true,
    errors: authErrors,
  },
  {
    id: 'logout',
    method: 'post',
    path: '/auth/logout',
    summary: 'Invalidar sesión',
    status: 204,
    access: 'session',
    csrf: true,
    errors: authErrors,
  },
  {
    id: 'me',
    method: 'get',
    path: '/auth/me',
    summary: 'Consultar usuario y raíz',
    response: I.AuthResponse,
    status: 200,
    access: 'session',
    errors: authErrors,
  },
  ...resourceOperations,
  ...transferOperations,
  deletionOperation,
  {
    id: 'liveness',
    method: 'get',
    path: '/health/live',
    summary: 'Comprobar proceso vivo',
    response: C.Health,
    status: 200,
    access: 'public',
    errors: [500],
  },
  {
    id: 'readiness',
    method: 'get',
    path: '/health/ready',
    summary: 'Comprobar disponibilidad sin detalles internos',
    response: C.Health,
    status: 200,
    access: 'public',
    errors: [500, 503],
  },
];
