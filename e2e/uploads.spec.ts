import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { accountPage, closeAccounts } from './support/accounts.ts';
import { api } from './support/api.ts';

test('selector múltiple y drag/drop completan SQS→worker→S3 sin polling individual', async ({
  browser,
}) => {
  const owner = await accountPage(browser, 'owner');
  const reader = await accountPage(browser, 'reader');
  const requests: string[] = [];
  owner.page.on('request', (request) =>
    requests.push(new URL(request.url()).pathname + new URL(request.url()).search),
  );
  const first = `multi-${Date.now()}.txt`;
  const second = `multi-${Date.now()}.csv`;
  const dropped = `drop-${Date.now()}.txt`;
  const contents = new Map([
    [first, Buffer.from('contenido UTF-8 selector múltiple\n')],
    [second, Buffer.from('columna,valor\nselector,1\n')],
    [dropped, Buffer.from('contenido enviado por arrastre\n')],
  ]);
  try {
    await owner.page.locator('#upload-files').setInputFiles(
      [...contents].map(([name, buffer]) => ({
        name,
        mimeType: 'text/plain',
        buffer,
      })),
    );
    await owner.page.evaluate(
      ({ name, content }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([content], name, { type: 'text/csv' }));
        document
          .querySelector('[aria-label="Zona para arrastrar y soltar archivos"]')!
          .dispatchEvent(
            new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
          );
      },
      { name: dropped, content: 'contenido enviado por arrastre\n' },
    );
    for (const name of contents.keys()) {
      const row = owner.page
        .getByRole('list', { name: 'Estado de los archivos seleccionados' })
        .getByRole('listitem')
        .filter({ hasText: name });
      await expect(
        row.getByRole('status').filter({ hasText: 'Almacenamiento completado' }),
      ).toBeVisible({ timeout: 45_000 });
    }
    const active = await api(owner.page, '/api/v1/uploads?active=true');
    expect(active.status).toBe(200);
    const ownReservation = await api(reader.page, '/api/v1/uploads', 'POST', {
      parentId: reader.rootId,
      name: `pending-${Date.now()}.txt`,
      size: 1,
    });
    const otherId = ownReservation.body.upload.id as string;
    expect(
      (await api(owner.page, '/api/v1/uploads?active=true')).body.items.map(
        (row: { id: string }) => row.id,
      ),
    ).not.toContain(otherId);
    expect(
      (await api(reader.page, '/api/v1/uploads?active=true')).body.items.map(
        (row: { id: string }) => row.id,
      ),
    ).toContain(otherId);
    await expect
      .poll(() => requests.filter((path) => path === '/api/v1/uploads?active=true').length)
      .toBeGreaterThan(0);
    expect(requests.filter((path) => /^\/api\/v1\/uploads\/[^/]+$/.test(path))).toEqual([]);
    for (const name of contents.keys()) {
      const download = owner.page.waitForEvent('download');
      await owner.page.getByRole('button', { name: `Descargar ${name}` }).click();
      const stream = await (await download).createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      const actual = Buffer.concat(chunks);
      expect(createHash('sha256').update(actual).digest('hex')).toBe(
        createHash('sha256').update(contents.get(name)!).digest('hex'),
      );
    }
  } finally {
    await closeAccounts(owner, reader);
  }
});
