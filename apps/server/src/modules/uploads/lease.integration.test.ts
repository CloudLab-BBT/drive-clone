import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeClients, pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { processUpload } from './process.ts';
import { UploadStore } from './store.ts';

const suite = process.env.RUN_UPLOAD_FAILURES === 'true' ? describe : describe.skip;
suite('renovación durante la escritura S3', () => {
  afterAll(async () => { await closeClients(); });

  it('mantiene el intento vigente mientras S3 tarda en responder', async () => {
    const userId = randomUUID();
    const rootId = randomUUID();
    await pool.query('INSERT INTO "User" (id,username,"passwordHash") VALUES ($1,$2,$3)',
      [userId, `t${userId.replaceAll('-', '').slice(0, 20)}`, 'prueba']);
    await pool.query(`INSERT INTO "Resource" (id,"ownerId",kind,name,"nameKey","isRoot",status,"updatedAt")
      VALUES ($1,$2,'FOLDER','Raíz','raíz',true,'ACTIVE',now())`, [rootId, userId]);
    const store = new UploadStore(pool);
    const bytes = Buffer.from('%PDF-1.7\nlease activo\n%%EOF\n');
    const upload = await store.create(userId, { parentId: rootId, name: 'lento.pdf', size: bytes.length });
    await store.start(upload.id, userId);
    const tempKey = `${randomUUID()}.ready`;
    await writeFile(join(config.tempDir, tempKey), bytes);
    await store.queue(upload.id, userId, tempKey, bytes.length,
      createHash('sha256').update(bytes).digest('hex'));
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const original = s3.send.bind(s3);
    let writing = false;
    const spy = vi.spyOn(s3, 'send').mockImplementation((async (command: unknown) => {
      if (command instanceof PutObjectCommand) { writing = true; await hold; }
      return original(command as never);
    }) as typeof s3.send);
    let visibilityRenewals = 0;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const processing = processUpload(upload.id, async () => { visibilityRenewals++; });
      await vi.waitFor(() => expect(writing).toBe(true));
      await pool.query(`UPDATE "Upload" SET "leaseUntil" = now() + interval '5 seconds' WHERE id = $1`,
        [upload.id]);
      await vi.advanceTimersByTimeAsync(20_000);
      const lease = await pool.query<{ remaining: number }>(`SELECT EXTRACT(EPOCH FROM
        "leaseUntil" - now())::integer AS remaining FROM "Upload" WHERE id = $1`, [upload.id]);
      expect(lease.rows[0].remaining).toBeGreaterThan(50);
      expect(visibilityRenewals).toBe(1);
      release();
      expect(await processing).toBe(true);
    } finally { release(); spy.mockRestore(); vi.useRealTimers(); }
  }, 30_000);
});
