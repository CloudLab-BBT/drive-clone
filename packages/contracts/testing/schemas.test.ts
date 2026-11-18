import { describe, expect, expectTypeOf, it } from 'vitest';
import { Ajv } from 'ajv';
import formats from 'ajv-formats';
import { CreateUpload, UploadMessage, DeleteMessage, WorkerMessage } from '../src/uploads.ts';
import { Credentials } from '../src/identity.ts';
import { Name, PageQuery } from '../src/common.ts';
import type { Static } from '@sinclair/typebox';
import { AuthorizationDecision, ResourceAction } from '../src/authorization.ts';
import { Resource, RenameResource, ShareInput, DeleteQuery } from '../src/resources.ts';
const ajv = new Ajv({ strict: false });
const addFormats = 'default' in formats ? formats.default : formats;
addFormats(ajv);
const id = '63915d74-c1ee-4c5e-87ee-0fc31aa34453';
describe('Esquemas de mensajes versionados', () => {
  it.each([['UPLOAD', UploadMessage], ['DELETE', DeleteMessage]] as const)(
    'acepta %s v1 y rechaza variantes incompatibles', (type, schema) => {
      const validate = ajv.compile(schema);
      expect(validate({ version: 1, type, id })).toBe(true);
      for (const invalid of [{ version: 2, type, id }, { version: 1, type, id: 'otro' },
        { version: 1, type, id, path: '/interno' }, { type, id }]) expect(validate(invalid)).toBe(false);
    });
  it('rechaza un tipo desconocido y acepta ambas ramas', () => {
    const validate = ajv.compile(WorkerMessage);
    expect(validate({ version: 1, type: 'UPLOAD', id })).toBe(true);
    expect(validate({ version: 1, type: 'DELETE', id })).toBe(true);
    expect(validate({ version: 1, type: 'EXECUTE', id })).toBe(false);
  });
});
describe('Entradas públicas', () => {
  it('deriva acciones de autorización como unión literal de TypeScript', () => {
    expectTypeOf<Static<typeof ResourceAction>>().toEqualTypeOf<
      'VIEW' | 'LIST_CHILDREN' | 'DOWNLOAD' | 'RENAME' | 'DELETE' | 'MANAGE_SHARES' | 'CREATE_CHILD'
    >();
  });
  it.each(['informe.pdf', 'Fotos de verano', 'niño', 'a'.repeat(120)])('acepta nombre %s', value => {
    expect(ajv.compile(Name)(value)).toBe(true);
  });
  it.each(['', '.', '..', 'a/b', 'a\\b', 'a\n', 'a\u007f', 'a\u0085', 'a'.repeat(121)])(
    'rechaza nombre inválido %j', value => expect(ajv.compile(Name)(value)).toBe(false));
  it('impide campos ajenos y nombres ausentes en renombrado', () => {
    const validate = ajv.compile(RenameResource);
    expect(validate({ name: 'nuevo.pdf' })).toBe(true);
    expect(validate({ name: 'nuevo.pdf', ownerId: id })).toBe(false);
    expect(validate({})).toBe(false);
  });
  it('acota tamaño y rechaza rutas/propietarios enviados por cliente', () => {
    const validate = ajv.compile(CreateUpload);
    const input = { parentId: id, name: 'informe.pdf', size: 104857600 };
    expect(validate(input)).toBe(true);
    expect(validate({ ...input, size: 104857601 })).toBe(false);
    expect(validate({ ...input, size: -1 })).toBe(false);
    expect(validate({ ...input, size: 0.5 })).toBe(false);
    expect(validate({ ...input, ownerId: id })).toBe(false);
  });
  it('valida permiso y exige confirmación de borrado', () => {
    const share = ajv.compile(ShareInput);
    expect(share({ username: 'usuario', permission: 'READ' })).toBe(true);
    expect(share({ username: 'usuario', permission: 'EDIT' })).toBe(true);
    expect(share({ username: 'usuario', permission: 'OWNER' })).toBe(false);
    const confirm = ajv.compile(DeleteQuery);
    expect(confirm({ confirmRecursive: true })).toBe(true);
    expect(confirm({ confirmRecursive: false })).toBe(false);
    expect(confirm({})).toBe(false);
  });
  it('no permite una autorización positiva de un recurso invisible', () => {
    const validate = ajv.compile(AuthorizationDecision);
    expect(validate({ visible: false, allowed: false, effectivePermission: null })).toBe(true);
    expect(validate({ visible: false, allowed: true, effectivePermission: 'EDIT' })).toBe(false);
    expect(validate({ visible: true, allowed: false, effectivePermission: 'READ' })).toBe(true);
  });
  it('distingue raíz, carpetas y archivos publicados sin exponer campos internos', () => {
    const validate = ajv.compile(Resource);
    const folder = { id, ownerId: id, name: 'Fotos', kind: 'FOLDER', isRoot: false, parentId: id,
      createdAt: '2026-11-17T12:00:00Z', updatedAt: '2026-11-17T12:00:00Z', effectivePermission: 'OWNER' };
    expect(validate(folder)).toBe(true);
    expect(validate({ ...folder, size: 1 })).toBe(false);
    expect(validate({ ...folder, isRoot: true })).toBe(false);
    expect(validate({ ...folder, isRoot: true, parentId: null })).toBe(true);
    expect(validate({ ...folder, kind: 'FILE' })).toBe(false);
    const file = { ...folder, kind: 'FILE', size: 5, mimeType: 'application/pdf' };
    expect(validate(file)).toBe(true);
    expect(validate({ ...file, objectKey: 'interno' })).toBe(false);
  });
  it('acota credenciales y paginación', () => {
    const credentials = ajv.compile(Credentials);
    expect(credentials({ username: 'benjamin', password: 'a'.repeat(15) })).toBe(true);
    expect(credentials({ username: '1ab', password: 'a'.repeat(15) })).toBe(false);
    expect(credentials({ username: 'benjamin', password: 'a'.repeat(14) })).toBe(false);
    expect(credentials({ username: 'benjamin', password: 'a'.repeat(129) })).toBe(false);
    const page = ajv.compile(PageQuery);
    expect(page({ limit: 100 })).toBe(true);
    expect(page({ limit: 101 })).toBe(false);
    expect(page({ limit: 0 })).toBe(false);
    expect(page({ cursor: 'a'.repeat(513) })).toBe(false);
  });
});
