import { expect, test } from '@playwright/test';
import { accountPage, closeAccounts } from './support/accounts.ts';
import { api } from './support/api.ts';

test('crea y navega carpetas, protege raíz, renombra y completa borrado recursivo', async ({
  browser,
}) => {
  const owner = await accountPage(browser, 'owner');
  const requests: string[] = [];
  owner.page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  const parent = `carpeta-${Date.now()}`;
  const child = `hija-${Date.now()}`;
  try {
    const rootEdit = await api(owner.page, `/api/v1/resources/${owner.rootId}`, 'PATCH', {
      name: 'otra-raiz',
    });
    expect(rootEdit.status).toBe(403);
    await owner.page.getByLabel('Nombre de la carpeta').fill(parent);
    await owner.page.getByRole('button', { name: 'Crear carpeta' }).click();
    await expect(owner.page.getByRole('button', { name: `Abrir ${parent}` })).toBeVisible();
    await owner.page.getByRole('button', { name: `Abrir ${parent}` }).click();
    await owner.page.getByLabel('Nombre de la carpeta').fill(child);
    await owner.page.getByRole('button', { name: 'Crear carpeta' }).click();
    await owner.page.getByRole('button', { name: `Renombrar ${child}` }).click();
    const dialog = owner.page.getByRole('dialog');
    await dialog.getByLabel('Nuevo nombre').fill(`${child}-renombrada`);
    await dialog.getByRole('button', { name: 'Guardar nombre' }).click();
    await expect(owner.page.getByText(`${child}-renombrada`)).toBeVisible();
    await owner.page.getByRole('button', { name: 'Volver' }).click();
    await owner.page.getByRole('button', { name: `Eliminar ${parent}` }).click();
    await expect(owner.page.getByText(/Se eliminará la carpeta y todo su contenido/)).toBeVisible();
    await owner.page.getByRole('button', { name: 'Confirmar eliminación' }).click();
    await expect(
      owner.page.getByRole('status').filter({ hasText: 'Eliminación completada' }),
    ).toBeVisible({ timeout: 45_000 });
    expect(requests.some((path) => /^\/api\/v1\/deletions\/[^/]+$/.test(path))).toBe(true);
    await expect(owner.page.getByRole('button', { name: `Abrir ${parent}` })).toHaveCount(0);
  } finally {
    await closeAccounts(owner);
  }
});
