import type { TSchema } from '@sinclair/typebox';
import * as C from './common.ts';
import * as I from './identity.ts';
import * as R from './resources.ts';
import * as U from './uploads.ts';
export interface Operation {
  id: string; method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string;
  summary: string; response?: TSchema; status: number; body?: TSchema; params?: TSchema;
  query?: TSchema; access: 'public' | 'session'; csrf?: boolean; errors: number[];
  binary?: 'request' | 'response';
}
const authErrors = [400, 401, 403, 429, 500, 503];
const resourceErrors = [...authErrors, 404, 409];
export const operations: Operation[] = [
  { id: 'getCsrf', method: 'get', path: '/auth/csrf', summary: 'Obtener sesión previa y token CSRF',
    response: I.CsrfResponse, status: 200, access: 'public', errors: [429, 500, 503] },
  { id: 'register', method: 'post', path: '/auth/register', summary: 'Registrar usuario y raíz',
    body: I.Credentials, response: I.AuthResponse, status: 201, access: 'public', csrf: true,
    errors: [400, 403, 409, 429, 500, 503] },
  { id: 'login', method: 'post', path: '/auth/login', summary: 'Autenticar y regenerar sesión',
    body: I.Credentials, response: I.AuthResponse, status: 200, access: 'public', csrf: true,
    errors: authErrors },
  { id: 'logout', method: 'post', path: '/auth/logout', summary: 'Invalidar sesión',
    status: 204, access: 'session', csrf: true, errors: authErrors },
  { id: 'me', method: 'get', path: '/auth/me', summary: 'Consultar usuario y raíz',
    response: I.AuthResponse, status: 200, access: 'session', errors: authErrors },
  { id: 'createFolder', method: 'post', path: '/folders', summary: 'Crear carpeta propia',
    body: R.CreateFolder, response: R.ResourceResponse, status: 201, access: 'session', csrf: true,
    errors: resourceErrors },
  { id: 'listChildren', method: 'get', path: '/folders/{id}/children', summary: 'Listar hijos autorizados',
    params: C.ResourceParams, query: C.PageQuery, response: R.ResourcePage, status: 200,
    access: 'session', errors: resourceErrors },
  { id: 'getResource', method: 'get', path: '/resources/{id}', summary: 'Consultar recurso autorizado',
    params: C.ResourceParams, response: R.ResourceResponse, status: 200, access: 'session',
    errors: resourceErrors },
  { id: 'renameResource', method: 'patch', path: '/resources/{id}', summary: 'Renombrar con EDIT o propiedad',
    params: C.ResourceParams, body: R.RenameResource, response: R.ResourceResponse, status: 200,
    access: 'session', csrf: true, errors: resourceErrors },
  { id: 'deleteResource', method: 'delete', path: '/resources/{id}', summary: 'Solicitar borrado durable confirmado',
    params: C.ResourceParams, query: R.DeleteQuery, response: R.DeletionResponse, status: 202,
    access: 'session', csrf: true, errors: resourceErrors },
  { id: 'listShared', method: 'get', path: '/shared', summary: 'Listar entradas compartidas directamente',
    query: C.PageQuery, response: R.SharedResourcePage, status: 200, access: 'session', errors: authErrors },
  { id: 'listShares', method: 'get', path: '/resources/{id}/shares', summary: 'Listar concesiones como propietario',
    params: C.ResourceParams, query: C.PageQuery, response: R.SharePage, status: 200,
    access: 'session', errors: resourceErrors },
  { id: 'upsertShare', method: 'put', path: '/resources/{id}/shares', summary: 'Conceder o actualizar permiso',
    params: C.ResourceParams, body: R.ShareInput, response: R.ShareResponse, status: 200,
    access: 'session', csrf: true, errors: resourceErrors },
  { id: 'revokeShare', method: 'delete', path: '/resources/{id}/shares/{userId}', summary: 'Revocar vía directa',
    params: R.ShareParams, response: R.RevokeResponse, status: 200, access: 'session', csrf: true,
    errors: resourceErrors },
  { id: 'createUpload', method: 'post', path: '/uploads', summary: 'Reservar nombre y cuota',
    body: U.CreateUpload, response: U.UploadResponse, status: 201, access: 'session', csrf: true,
    errors: [...resourceErrors, 413, 415] },
  { id: 'receiveContent', method: 'put', path: '/uploads/{id}/content', summary: 'Recibir un archivo por streaming',
    params: C.ResourceParams, binary: 'request', response: U.UploadResponse, status: 202,
    access: 'session', csrf: true, errors: [...resourceErrors, 413, 415] },
  { id: 'listActiveUploads', method: 'get', path: '/uploads', summary: 'Consultar cargas propias no terminales',
    query: U.ActiveQuery, response: U.ActiveUploads, status: 200, access: 'session', errors: authErrors },
  { id: 'getUpload', method: 'get', path: '/uploads/{id}', summary: 'Consultar carga propia',
    params: C.ResourceParams, response: U.UploadResponse, status: 200, access: 'session', errors: resourceErrors },
  { id: 'cancelUpload', method: 'post', path: '/uploads/{id}/cancel', summary: 'Solicitar cancelación idempotente',
    params: C.ResourceParams, response: U.UploadResponse, status: 200, access: 'session', csrf: true,
    errors: resourceErrors },
  { id: 'download', method: 'get', path: '/files/{id}/download', summary: 'Descargar archivo autorizado',
    params: C.ResourceParams, binary: 'response', status: 200, access: 'session', errors: resourceErrors },
  { id: 'getDeletion', method: 'get', path: '/deletions/{id}', summary: 'Consultar como solicitante o propietario',
    params: C.ResourceParams, response: R.DeletionResponse, status: 200, access: 'session', errors: resourceErrors },
  { id: 'liveness', method: 'get', path: '/health/live', summary: 'Comprobar proceso vivo',
    response: C.Health, status: 200, access: 'public', errors: [500] },
  { id: 'readiness', method: 'get', path: '/health/ready', summary: 'Comprobar disponibilidad sin detalles internos',
    response: C.Health, status: 200, access: 'public', errors: [500, 503] },
];
