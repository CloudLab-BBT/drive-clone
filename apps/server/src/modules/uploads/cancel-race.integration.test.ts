import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { cleanupCancellation, requestCancellation } from './cancel.ts';
import { processUpload, renew } from './process.ts';
import { UploadStore } from './store.ts';

const suite = process.env.RUN_UPLOAD_FAILURES === 'true' ? describe : describe.skip;
suite('cancelación persistente de cargas', () => {
  afterAll(async () => {
    await closeClients();
  });
  const store = new UploadStore(pool);
  async function actor() {
    const userId = randomUUID();
    const rootId = randomUUID();
    await pool.query('INSERT INTO "User" (id,username,"passwordHash") VALUES ($1,$2,$3)', [
      userId,
      `t${userId.replaceAll('-', '').slice(0, 20)}`,
      'prueba',
    ]);
    await pool.query(
      `INSERT INTO "Resource" (id,"ownerId",kind,name,"nameKey","isRoot",status,"updatedAt")
      VALUES ($1,$2,'FOLDER','Raíz','raíz',true,'ACTIVE',now())`,
      [rootId, userId],
    );
    return { userId, rootId };
  }
  async function queued(userId: string, rootId: string) {
    const bytes = Buffer.from('%PDF-1.7\ncancelación\n%%EOF\n');
    const row = await store.create(userId, {
      parentId: rootId,
      name: `${randomUUID()}.pdf`,
      size: bytes.length,
    });
    await store.start(row.id, userId);
    const key = `${randomUUID()}.ready`;
    await writeFile(join(config.tempDir, key), bytes);
    await store.queue(
      row.id,
      userId,
      key,
      bytes.length,
      createHash('sha256').update(bytes).digest('hex'),
    );
    return row;
  }

  it('impide que el intento activo publique tras cancelar durante S3', async () => {
    const { userId, rootId } = await actor();
    const row = await queued(userId, rootId);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = s3.send.bind(s3);
    let writing = false;
    const spy = vi.spyOn(s3, 'send').mockImplementation((async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        writing = true;
        await hold;
      }
      return original(command as never);
    }) as typeof s3.send);
    try {
      const processing = processUpload(row.id);
      await vi.waitFor(() => expect(writing).toBe(true));
      const cancelled = await requestCancellation(row.id, userId);
      expect(cancelled.status).toBe('CANCEL_REQUESTED');
      expect(await renew(row.id, cancelled.attemptId!)).toBe(false);
      release();
      expect(await processing).toBe(false);
      expect((await store.get(row.id, userId)).status).toBe('CANCELLED');
      const resource = await pool.query('SELECT id FROM "Resource" WHERE id = $1', [
        row.resourceId,
      ]);
      expect(resource.rowCount).toBe(0);
    } finally {
      release();
      spy.mockRestore();
    }
  }, 30_000);
});
