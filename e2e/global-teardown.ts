import { rm } from 'node:fs/promises';
import type { FullConfig } from '@playwright/test';

export default async function teardown(config: FullConfig) {
  const stateDir = String(config.metadata.stateDir);
  if (!stateDir.startsWith('/tmp/drive-clone-e2e-')) return;
  await rm(stateDir, { recursive: true, force: true });
}
