import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createOpenApi } from '../src/openapi.ts';
import { UploadMessage, DeleteMessage } from '../src/uploads.ts';
const directory = new URL('../generated/', import.meta.url);
const documents = { 'openapi.json': createOpenApi(),
  'upload-message.v1.schema.json': { $schema: 'http://json-schema.org/draft-07/schema#', ...UploadMessage },
  'delete-message.v1.schema.json': { $schema: 'http://json-schema.org/draft-07/schema#', ...DeleteMessage } };
await mkdir(directory, { recursive: true });
for (const [name, document] of Object.entries(documents)) {
  const content = JSON.stringify(document) + '\n';
  const file = new URL(name, directory);
  if (process.argv.includes('--check')) {
    if (await readFile(file, 'utf8') !== content) throw new Error(`Contrato generado desactualizado: ${name}`);
  } else await writeFile(file, content);
}
console.log('Contratos verificados.');
