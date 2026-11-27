-- Keep the pending dispatch when earlier O13 versions created duplicate rows.
DELETE FROM "Outbox" o USING (
  SELECT id, row_number() OVER (
    PARTITION BY type, "entityId", version
    ORDER BY ("publishedAt" IS NULL) DESC, "createdAt" DESC, id DESC
  ) AS position FROM "Outbox"
) ranked WHERE o.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX "Outbox_type_entityId_version_key"
  ON "Outbox"(type,"entityId",version);
