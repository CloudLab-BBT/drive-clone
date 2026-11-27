import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type FullConfig } from '@playwright/test';

export default async function setup(config: FullConfig) {
  const stateDir = String(config.metadata.stateDir);
  await mkdir(stateDir, { recursive: true });
  const browser = await chromium.launch();
  const accounts: Record<string, { username: string; state: string; rootId: string }> = {};
  try {
    for (const role of ['owner', 'reader', 'outsider']) {
      const username = `e2e${randomUUID().replaceAll('-', '').slice(0, 20)}`;
      const context = await browser.newContext({
        baseURL: config.projects[0].use.baseURL as string,
      });
      const page = await context.newPage();
      await page.goto('/register');
      await page.getByLabel('Nombre de usuario').fill(username);
      await page.getByLabel('Contraseña').fill(`E2e!${randomUUID()}secure-pass`);
      await page.getByRole('button', { name: 'Registrarse' }).click();
      await page.getByRole('heading', { name: 'Mi Unidad' }).waitFor();
      const state = `${stateDir}/${role}.json`;
      const rootId = (await page.locator('.card code').textContent())?.trim();
      if (!rootId) throw new Error(`No se encontró la raíz de ${role}`);
      await context.storageState({ path: state });
      accounts[role] = { username, state, rootId };
      await context.close();
    }
    await writeFile(`${stateDir}/accounts.json`, JSON.stringify(accounts));
  } finally {
    await browser.close();
  }
}
