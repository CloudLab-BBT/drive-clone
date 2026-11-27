import { expect, test } from '@playwright/test';
import { accountPage, closeAccounts } from './support/accounts.ts';
import { api } from './support/api.ts';

test('comparte sin exponer ancestros, limita READ y conserva permiso heredado al revocar', async ({
  browser,
}) => {
  const owner = await accountPage(browser, 'owner');
  const reader = await accountPage(browser, 'reader');
  const outsider = await accountPage(browser, 'outsider');
  const privateName = `privada-${Date.now()}`;
  const sharedName = `compartida-${Date.now()}`;
  const childName = `hija-${Date.now()}`;
  try {
    await owner.page.getByLabel('Nombre de la carpeta').fill(privateName);
    await owner.page.getByRole('button', { name: 'Crear carpeta' }).click();
    await owner.page.getByRole('button', { name: `Abrir ${privateName}` }).click();
    await owner.page.getByLabel('Nombre de la carpeta').fill(sharedName);
    await owner.page.getByRole('button', { name: 'Crear carpeta' }).click();
    await owner.page.getByRole('button', { name: `Abrir ${sharedName}` }).click();
    await owner.page.getByLabel('Nombre de la carpeta').fill(childName);
    await owner.page.getByRole('button', { name: 'Crear carpeta' }).click();
    await owner.page.getByRole('button', { name: 'Volver' }).click();
    await owner.page.getByRole('button', { name: `Compartir ${sharedName}` }).click();
    const parentDialog = owner.page.getByRole('dialog');
    await parentDialog.getByLabel('Nombre de usuario').fill(reader.username);
    await parentDialog.getByLabel('Permiso').selectOption('READ');
    await parentDialog.getByRole('button', { name: 'Guardar permiso' }).click();
    await owner.page.getByRole('button', { name: 'Cerrar' }).click();
    await owner.page.getByRole('button', { name: `Abrir ${sharedName}` }).click();
    await owner.page.getByRole('button', { name: `Compartir ${childName}` }).click();
    const childDialog = owner.page.getByRole('dialog');
    await childDialog.getByLabel('Nombre de usuario').fill(reader.username);
    await childDialog.getByLabel('Permiso').selectOption('EDIT');
    await childDialog.getByRole('button', { name: 'Guardar permiso' }).click();
    await childDialog.getByRole('button', { name: `Revocar ${reader.username}` }).click();
    await expect(
      childDialog.getByRole('status').filter({ hasText: 'Conserva acceso heredado de lectura' }),
    ).toBeVisible();
    const rootChildren = (await api(owner.page, `/api/v1/folders/${owner.rootId}/children`)).body
      .items;
    const shared = rootChildren.find((item: { name: string }) => item.name === privateName);
    const sharedChildren = (await api(owner.page, `/api/v1/folders/${shared.id}/children`)).body
      .items;
    const sharedResource = sharedChildren.find(
      (item: { name: string }) => item.name === sharedName,
    );
    const child = (
      await api(owner.page, `/api/v1/folders/${sharedResource.id}/children`)
    ).body.items.find((item: { name: string }) => item.name === childName);
    expect((await api(outsider.page, `/api/v1/resources/${child.id}`)).status).toBe(404);
    const denied = await api(reader.page, '/api/v1/folders', 'POST', {
      parentId: sharedResource.id,
      name: `denied-${Date.now()}`,
    });
    expect(denied.status).toBe(403);
    const deniedUpload = await api(reader.page, '/api/v1/uploads', 'POST', {
      parentId: sharedResource.id,
      name: `denied-${Date.now()}.txt`,
      size: 1,
    });
    expect(deniedUpload.status).toBe(403);
    await reader.page.getByRole('button', { name: `Abrir ${sharedName}` }).click();
    await expect(reader.page.getByText(privateName)).toHaveCount(0);
    await expect(reader.page.getByRole('button', { name: `Renombrar ${childName}` })).toHaveCount(
      0,
    );
    await expect(reader.page.getByRole('button', { name: 'Crear carpeta' })).toHaveCount(0);
  } finally {
    await closeAccounts(owner, reader, outsider);
  }
});
