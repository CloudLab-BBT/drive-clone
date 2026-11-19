ALTER TABLE "Resource" DROP CONSTRAINT "Resource_active_file_metadata";
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_active_file_metadata" CHECK (
  kind <> 'FILE' OR status <> 'ACTIVE' OR
  (size IS NOT NULL AND size >= 0 AND "mimeType" IS NOT NULL AND
   sha256 IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$' AND "objectKey" IS NOT NULL)
);
CREATE INDEX "Share_resourceId_createdAt_userId_idx" ON "Share"("resourceId", "createdAt", "userId");

CREATE OR REPLACE FUNCTION guard_resource_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_kind text; parent_status text; depth int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."ownerId" <> NEW."ownerId" OR OLD."parentId" IS DISTINCT FROM NEW."parentId" OR
       OLD."isRoot" <> NEW."isRoot" OR OLD.kind <> NEW.kind THEN
      RAISE EXCEPTION 'La propiedad, ubicación y tipo del recurso son inmutables';
    END IF;
    IF OLD."isRoot" AND (OLD.name <> NEW.name OR OLD.status <> NEW.status) THEN
      RAISE EXCEPTION 'La raíz está protegida';
    END IF;
  END IF;
  IF NOT NEW."isRoot" AND TG_OP = 'INSERT' THEN
    IF NEW."parentId" = NEW.id THEN RAISE EXCEPTION 'Un recurso no puede ser su propio padre'; END IF;
    SELECT kind, status INTO parent_kind, parent_status
      FROM "Resource" WHERE id = NEW."parentId";
    IF NOT FOUND OR parent_kind IS DISTINCT FROM 'FOLDER' OR parent_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'El padre debe ser una carpeta activa existente';
    END IF;
    WITH RECURSIVE ancestors AS (
      SELECT id, "parentId", 1 AS level FROM "Resource" WHERE id = NEW."parentId"
      UNION ALL
      SELECT r.id, r."parentId", a.level + 1 FROM "Resource" r
        JOIN ancestors a ON r.id = a."parentId" WHERE a.level <= 10
    ) SELECT max(level) INTO depth FROM ancestors;
    IF depth > 10 THEN RAISE EXCEPTION 'Profundidad máxima excedida'; END IF;
  END IF;
  RETURN NEW;
END $$;
