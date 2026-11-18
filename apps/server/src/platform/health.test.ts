import { describe, expect, it } from 'vitest';
import { bounded } from './health.ts';

describe('comprobación de dependencias', () => {
  it('distingue éxito, fallo y timeout sin exponer la causa', async () => {
    expect(await bounded('db', async () => true, 20)).toEqual(['db', true]);
    expect(await bounded('db', async () => { throw new Error('secreto'); }, 20)).toEqual(['db', false]);
    expect(await bounded('db', () => new Promise(() => {}), 5)).toEqual(['db', false]);
    expect(await bounded('db', async () => true, 20)).toEqual(['db', true]);
  });
});
