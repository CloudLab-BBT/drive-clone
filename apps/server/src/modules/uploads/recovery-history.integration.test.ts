import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeClients, pool } from '../../platform/clients.ts';
import { pruneRecoveryHistory } from './history.ts';
import { queued } from './recovery-fixture.ts';

const suite = process.env.RUN_O13_INTEGRATION === 'true' ? describe : describe.skip;
suite('retención de diagnóstico', () => {
  afterAll(async () => {
    await closeClients();
  });

  it('elimina solo observaciones y envíos antiguos, conservando Outbox pendiente', async () => {
    const old = await queued();
    const pending = await queued();
    await pool.query(
      `UPDATE "Outbox" SET "publishedAt" = now() - interval '31 days'
      WHERE "entityId" = $1`,
      [old.upload.id],
    );
    const oldId = randomUUID();
    const recentId = randomUUID();
    for (const [id, days] of [
      [oldId, 31],
      [recentId, 0],
    ] as const)
      await pool.query(
        `INSERT INTO "QueueObservation"
        (id,"messageId","uploadId",source,"receiveCount",outcome,"observedAt")
        VALUES ($1,$2,$3,'MAIN',1,'ACKED',now() - ($4::int * interval '1 day'))`,
        [id, randomUUID(), old.upload.id, days],
      );
    await pruneRecoveryHistory();
    const observations = await pool.query<{ id: string }>(
      'SELECT id FROM "QueueObservation" WHERE id = ANY($1::uuid[])',
      [[oldId, recentId]],
    );
    expect(observations.rows.map((row) => row.id)).toEqual([recentId]);
    const published = await pool.query('SELECT id FROM "Outbox" WHERE "entityId" = $1', [
      old.upload.id,
    ]);
    expect(published.rowCount).toBe(0);
    const waiting = await pool.query('SELECT id FROM "Outbox" WHERE "entityId" = $1', [
      pending.upload.id,
    ]);
    expect(waiting.rowCount).toBe(1);
  });
});
