import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { pool, s3 } from '../../platform/clients.ts';
import { config } from '../../platform/config.ts';

export async function verifyPublishedObjects(alert: (resourceId: string) => void): Promise<void> {
  let cursor = '00000000-0000-0000-0000-000000000000';
  while (true) {
    const batch = await pool.query<{ id: string; objectKey: string }>(
      `SELECT id,"objectKey" FROM "Resource"
      WHERE kind = 'FILE' AND status = 'ACTIVE' AND "objectKey" IS NOT NULL
        AND id > $1 ORDER BY id LIMIT 100`,
      [cursor],
    );
    if (!batch.rowCount) return;
    for (const row of batch.rows) {
      cursor = row.id;
      try {
        await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: row.objectKey }));
      } catch (error) {
        const name = (error as { name?: string }).name;
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (name !== 'NoSuchKey' && !(name === 'NotFound' && status === 404)) throw error;
        const updated = await pool.query(
          `UPDATE "Resource" SET status = 'UNAVAILABLE', "updatedAt" = now()
          WHERE id = $1 AND status = 'ACTIVE' AND "objectKey" = $2 RETURNING id`,
          [row.id, row.objectKey],
        );
        if (updated.rowCount) alert(row.id);
      }
    }
    if (batch.rowCount < 100) return;
  }
}
