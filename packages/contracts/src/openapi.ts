import { Type } from '@sinclair/typebox';
import { ErrorResponse } from './common.ts';
import { operations } from './operations.ts';
import type { Operation } from './operations.ts';
function parameters(operation: Operation) {
  const result: object[] = [];
  for (const [location, schema] of [['path', operation.params], ['query', operation.query]] as const) {
    for (const [name, property] of Object.entries(schema?.properties ?? {})) {
      result.push({ name, in: location, required: location === 'path' || schema?.required?.includes(name),
        schema: property });
    }
  }
  if (operation.csrf) result.push({ name: 'x-csrf-token', in: 'header', required: true,
    schema: { type: 'string', minLength: 1 }, description: 'Token de la sesión previa y Origin esperado obligatorios.' });
  return result;
}
function specification(operation: Operation) {
  const content = (schema: object) => ({ 'application/json': { schema } });
  const responses: Record<string, object> = Object.fromEntries(operation.errors.map(status => [status,
    { description: 'Error seguro; consultar catálogo en docs/api.md.', content: content(
      operation.id === 'readiness' && status === 503 ? operation.response! : ErrorResponse) }]));
  responses[operation.status] = { description: 'Operación aceptada según contrato.',
    ...(operation.response ? { content: content(operation.response) } : {}),
    ...(operation.binary === 'response' ? { content: { 'application/octet-stream': {
      schema: { type: 'string', format: 'binary' } } }, headers: {
      'Content-Disposition': { schema: { type: 'string' }, description: 'attachment; nombre codificado seguro' },
      'Cache-Control': { schema: { type: 'string', const: 'private, no-store' } },
      'X-Content-Type-Options': { schema: { type: 'string', const: 'nosniff' } },
    } } : {}) };
  const multipart = Type.Object({ file: Type.String({ format: 'binary' }) }, { additionalProperties: false });
  return { operationId: operation.id, summary: operation.summary, parameters: parameters(operation),
    security: operation.access === 'session' || operation.csrf ? [{ sessionCookie: [] }] : [],
    ...(operation.body ? { requestBody: { required: true, content: content(operation.body) } } : {}),
    ...(operation.binary === 'request' ? { requestBody: { required: true,
      content: { 'multipart/form-data': { schema: multipart } } } } : {}), responses };
}
export function createOpenApi() {
  const paths: Record<string, Record<string, object>> = {};
  for (const operation of operations) (paths[operation.path] ??= {})[operation.method] = specification(operation);
  return { openapi: '3.1.0', info: { title: 'Contratos del clon de Drive', version: '1.0.0',
    description: 'Especificación; no acredita endpoints implementados.' },
    servers: [{ url: '/api/v1' }], paths,
    components: { securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: 'drive_session' } } } };
}
