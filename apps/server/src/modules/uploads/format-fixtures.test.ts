import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { samples } from './format-fixtures.ts';
import { officeSample } from './office-fixtures.ts';
import { validateContainer, validateSignature } from './validation.ts';

describe('firmas y estructura de los 26 formatos', () => {
  it('reconoce muestras de todos los formatos y no depende del MIME declarado', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'drive-formats-'));
    try {
      for (const [extension, bytes] of Object.entries(samples)) {
        const path = join(directory, `sample.${extension}`);
        await writeFile(path, bytes);
        expect(validateSignature(extension, bytes.subarray(0, 512)), extension).toBe(true);
        expect(await validateContainer(path, extension), extension).toBe(true);
      }
      expect(Object.keys(samples)).toHaveLength(26);
      expect(validateSignature('png', samples.pdf.subarray(0, 512))).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rechaza ZIP Office cifrado y con ratio de compresión mayor de 100:1', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'drive-invalid-zip-'));
    try {
      const cases: Array<[string, Buffer]> = [
        ['encrypted', officeSample('docx', { encrypted: true })],
        ['ratio', officeSample('docx', { compressionRatio: true })],
      ];
      for (const [label, bytes] of cases) {
        const path = join(directory, `${label}.docx`);
        await writeFile(path, bytes);
        expect(await validateContainer(path, 'docx'), label).toBe(false);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
