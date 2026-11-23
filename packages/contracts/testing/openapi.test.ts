import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import SwaggerParser from '@apidevtools/swagger-parser';
import { operations } from '../src/operations.ts';
import { createOpenApi } from '../src/openapi.ts';
describe('Contrato HTTP publicable', () => {
  it('es un documento OpenAPI válido', async () => {
    const file = new URL('../generated/openapi.json', import.meta.url);
    const document = JSON.parse(await readFile(file, 'utf8'));
    await expect(SwaggerParser.validate(document)).resolves.toBeDefined();
  });
  it('readiness usa un cuerpo de disponibilidad seguro también en 503', () => {
    const operation = createOpenApi().paths['/health/ready']?.get as {
      responses: Record<string, { content: unknown }>;
    };
    expect(operation.responses['503']?.content).toEqual(operation.responses['200']?.content);
  });
  it('conserva un identificador único por operación y cubre el mínimo acordado', () => {
    expect(new Set(operations.map(o => o.id)).size).toBe(23);
    expect(operations).toHaveLength(23);
    for (const id of ['createUpload', 'receiveContent', 'cancelUpload', 'listActiveUploads',
      'upsertShare', 'revokeShare', 'deleteResource', 'getDeletion', 'download']) {
      expect(operations.some(operation => operation.id === id)).toBe(true);
    }
  });
  it('exige sesión y CSRF en mutaciones, incluida sesión previa en login/registro', () => {
    const document = createOpenApi();
    for (const operation of operations.filter(o => o.method !== 'get')) {
      expect(operation.csrf).toBe(true);
      const specification = document.paths[operation.path]?.[operation.method] as {
        parameters: { name: string; required: boolean }[]; security: object[];
      };
      expect(specification.security).toEqual([{ sessionCookie: [] }]);
      expect(specification.parameters).toContainEqual(expect.objectContaining({
        name: 'x-csrf-token', required: true,
      }));
    }
  });
  it('publica parámetros de ruta y consulta y no presenta binarios como JSON', () => {
    const document = createOpenApi();
    const serialized = JSON.stringify(document);
    expect(serialized).toContain('multipart/form-data');
    expect(serialized).toContain('application/octet-stream');
    for (const operation of operations) {
      const placeholders = [...operation.path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
      expect(Object.keys(operation.params?.properties ?? {})).toEqual(placeholders);
    }
  });
  it('omite parentId en el esquema de /shared', () => {
    const response = (createOpenApi().paths['/shared']?.get as {
      responses: Record<string, { content: Record<string, { schema: unknown }> }>;
    }).responses['200'].content['application/json'].schema;
    expect(JSON.stringify(response)).not.toContain('parentId');
  });
});
