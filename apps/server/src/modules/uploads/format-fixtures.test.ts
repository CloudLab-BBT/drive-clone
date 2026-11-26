import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { samples } from './format-fixtures.ts';
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
});
