import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';
import { normalizeName } from './validation.ts';
import type { UploadRow } from './store.ts';
import { AuthorizationService } from '../authorization/service.ts';
import { AppError } from '../identity/errors.ts';

interface Job extends UploadRow { name: string }

async function acquire(id: string): Promise<{ job: Job; attemptId: string; objectKey: string } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<Job>(`SELECT u.*,r.name FROM "Upload" u JOIN "Resource" r ON r.id = u."resourceId"
      WHERE u.id = $1 AND u.status = 'QUEUED' AND (u."nextAttemptAt" IS NULL OR u."nextAttemptAt" <= now())
      FOR UPDATE OF u`, [id]);
    const job = found.rows[0];
    if (!job || !job.tempKey || job.attemptCount >= 3) { await client.query('COMMIT'); return null; }
    const attemptId = randomUUID();
    const objectKey = `uploads/${job.userId}/${job.id}/${attemptId}`;
    await client.query(`UPDATE "Upload" SET status = 'PROCESSING', "attemptId" = $2,
      "attemptCount" = "attemptCount" + 1, "leaseUntil" = now() + interval '60 seconds',
      "updatedAt" = now() WHERE id = $1`, [id, attemptId]);
    await client.query(`INSERT INTO "UploadAttempt" (id,"uploadId","objectKey",status,"updatedAt")
      VALUES ($1,$2,$3,'WRITING',now())`, [attemptId, id, objectKey]);
    await client.query('COMMIT');
    return { job, attemptId, objectKey };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function renew(id: string, attemptId: string): Promise<boolean> {
  const result = await pool.query(`UPDATE "Upload" SET "leaseUntil" = now() + interval '60 seconds'
    WHERE id = $1 AND "attemptId" = $2 AND status = 'PROCESSING' AND "leaseUntil" > now()`, [id, attemptId]);
  return result.rowCount === 1;
}

async function verifyTemp(path: string, expectedSize: number, expectedHash: string): Promise<void> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; hash.update(chunk); }
  if (bytes !== expectedSize || hash.digest('hex') !== expectedHash) throw new Error('Temporal alterado');
}

async function complete(job: Job, attemptId: string, objectKey: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [job.userId]);
    const target = await client.query<{ parentId: string; status: string }>(
      'SELECT "parentId",status FROM "Resource" WHERE id = $1 FOR UPDATE', [job.resourceId]);
    if (target.rows[0]?.status !== 'RESERVED') { await client.query('ROLLBACK'); return false; }
    const access = await new AuthorizationService(client).evaluate({ actorId: job.userId,
      resourceId: target.rows[0].parentId, action: 'CREATE_CHILD' });
    if (!access.allowed) throw new AppError('RESOURCE_UNAVAILABLE', 'Carpeta no disponible', 404);
    const result = await client.query(`UPDATE "Upload" SET status = 'COMPLETED', "leaseUntil" = NULL,
      "updatedAt" = now() WHERE id = $1 AND "attemptId" = $2 AND status = 'PROCESSING'
      AND "leaseUntil" > now() RETURNING id`, [job.id, attemptId]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return false; }
    const resource = await client.query(`UPDATE "Resource" SET status = 'ACTIVE', size = $2, "mimeType" = $3,
      sha256 = $4, "objectKey" = $5, "updatedAt" = now()
      WHERE id = $1 AND status = 'RESERVED'`, [job.resourceId, job.receivedBytes,
      normalizeName(job.name).mimeType, job.sha256, objectKey]);
    if (resource.rowCount !== 1) { await client.query('ROLLBACK'); return false; }
    await client.query(`UPDATE "User" SET "reservedBytes" = "reservedBytes" - $2,
      "usedBytes" = "usedBytes" + $2 WHERE id = $1`, [job.userId, job.expectedSize]);
    await client.query(`UPDATE "UploadAttempt" SET status = 'PUBLISHED', "updatedAt" = now() WHERE id = $1`, [attemptId]);
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function fail(job: Job, attemptId: string, cleaned: boolean, unavailable = false) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const terminal = unavailable || job.attemptCount + 1 >= 3;
    const result = await client.query(`UPDATE "Upload" SET status = $3, "attemptId" = NULL,
      "leaseUntil" = NULL, "nextAttemptAt" = CASE WHEN $4 THEN NULL ELSE now() + interval '30 seconds' END,
      "errorCode" = CASE WHEN $4 THEN 'PROCESSING_FAILED' ELSE NULL END,
      "cleanupPending" = NOT $5,
      "updatedAt" = now() WHERE id = $1 AND "attemptId" = $2 AND status = 'PROCESSING'
      RETURNING id`, [job.id, attemptId, terminal ? 'FAILED' : 'QUEUED', terminal, cleaned]);
    if (terminal && cleaned && result.rowCount) {
      await client.query('DELETE FROM "Resource" WHERE id = $1 AND status = $2', [job.resourceId, 'RESERVED']);
      await client.query(`UPDATE "User" SET "reservedBytes" = "reservedBytes" - $2
        WHERE id = $1`, [job.userId, job.expectedSize]);
    }
    await client.query(`UPDATE "UploadAttempt" SET status = 'DISCARDED', "updatedAt" = now() WHERE id = $1`, [attemptId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function processUpload(id: string, renewVisibility?: () => Promise<void>): Promise<boolean> {
  const acquired = await acquire(id);
  if (!acquired) {
    const state = await pool.query<{ status: string }>('SELECT status FROM "Upload" WHERE id = $1', [id]);
    return !state.rows[0] || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(state.rows[0].status);
  }
  const { job, attemptId, objectKey } = acquired;
  let leaseLost = false;
  let completed = false;
  const timer = setInterval(() => {
    void renew(id, attemptId).then(async (ok) => {
      if (!ok) { leaseLost = true; return; }
      await renewVisibility?.();
    }).catch(() => { leaseLost = true; });
  }, 20_000);
  try {
    await verifyTemp(join(config.tempDir, job.tempKey!), Number(job.receivedBytes), job.sha256!);
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: objectKey,
      Body: createReadStream(join(config.tempDir, job.tempKey!)),
      ContentLength: Number(job.receivedBytes), ContentType: normalizeName(job.name).mimeType }));
    if (leaseLost || !(await complete(job, attemptId, objectKey))) {
      await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }));
      return false;
    }
    completed = true;
    try { await rm(join(config.tempDir, job.tempKey!), { force: true }); }
    catch {
      await pool.query('UPDATE "Upload" SET "cleanupPending" = true WHERE id = $1', [job.id]);
    }
    return true;
  } catch (error) {
    if (completed) return true;
    if (leaseLost) return false;
    let cleaned = true;
    try { await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey })); }
    catch { cleaned = false; }
    const unavailable = error instanceof AppError && error.code === 'RESOURCE_UNAVAILABLE';
    if ((unavailable || job.attemptCount + 1 >= 3) && cleaned) {
      try { await rm(join(config.tempDir, job.tempKey!), { force: true }); }
      catch { cleaned = false; }
    }
    await fail(job, attemptId, cleaned, unavailable);
    return false;
  } finally { clearInterval(timer); }
}
