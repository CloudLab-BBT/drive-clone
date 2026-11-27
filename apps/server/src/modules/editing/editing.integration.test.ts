import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { closeClients } from '../../platform/clients.ts';
import { editingSession, storedFile } from './editing.fixture.ts';

const suite = process.env.RUN_FILES_INTEGRATION === 'true' ? describe : describe.skip;

suite('O12 renombrado con permisos reales', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ rateLimit: false });
  });
  afterAll(async () => {
    await app.close();
    await closeClients();
  });

  it('comprueba READ, EDIT y tercero, y conserva contenido, identidad y concesión', async () => {
    const [owner, editor, reader, outsider] = await Promise.all(
      Array.from({ length: 4 }, () => editingSession(app)),
    );
    const parent = (await owner.create(owner.rootId, 'Privada')).json().resource.id;
    const file = await storedFile(owner.id, parent);
    expect((await owner.share(file.id, editor.username, 'EDIT')).statusCode).toBe(200);
    expect((await owner.share(file.id, reader.username, 'READ')).statusCode).toBe(200);
    expect((await reader.rename(file.id, 'otro.txt')).statusCode).toBe(403);
    expect((await outsider.rename(file.id, 'otro.txt')).statusCode).toBe(404);
    expect((await editor.download(file.id)).rawPayload).toEqual(file.bytes);
    expect((await editor.rename(file.id, 'otro.pdf')).statusCode).toBe(400);
    expect((await editor.rename(file.id, '../otro.txt')).statusCode).toBe(400);
    expect((await owner.create(parent, 'Duplicado.TXT')).statusCode).toBe(201);
    expect((await editor.rename(file.id, 'duplicado.txt')).statusCode).toBe(409);
    const rename = await editor.rename(file.id, '  A\u0301rbol.TXT  ');
    expect(rename.statusCode, rename.body).toBe(200);
    expect(rename.json().resource).toMatchObject({ id: file.id, name: 'Árbol.TXT' });
    expect(rename.json().resource).not.toHaveProperty('parentId');
    expect((await reader.download(file.id)).rawPayload).toEqual(file.bytes);
    expect((await owner.rename(parent, 'Cambios')).statusCode).toBe(200);
    expect((await owner.rename(owner.rootId, 'Nueva raíz')).statusCode).toBe(403);
  });
});
