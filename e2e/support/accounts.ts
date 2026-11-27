import { readFile } from 'node:fs/promises';
import type { Browser, BrowserContext, Page } from '@playwright/test';

type Role = 'owner' | 'reader' | 'outsider';
type Accounts = Record<Role, { username: string; state: string; rootId: string }>;

export async function accountPage(browser: Browser, role: Role) {
  const path = `${process.env.E2E_STATE_DIR ?? '/tmp/drive-clone-e2e-state'}/accounts.json`;
  const accounts = JSON.parse(await readFile(path, 'utf8')) as Accounts;
  const context = await browser.newContext({ storageState: accounts[role].state });
  const page = await context.newPage();
  await page.goto('/');
  return { context, page, username: accounts[role].username, rootId: accounts[role].rootId };
}

export async function closeAccounts(...accounts: { context: BrowserContext; page: Page }[]) {
  await Promise.all(accounts.map(({ context }) => context.close()));
}
