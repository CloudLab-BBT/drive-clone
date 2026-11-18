ALTER TABLE "User" ADD CONSTRAINT "User_username_format" CHECK (username ~ '^[a-z][a-z0-9_-]{2,31}$');
ALTER TABLE "User" ADD CONSTRAINT "User_quota_nonnegative" CHECK ("reservedBytes" >= 0 AND "usedBytes" >= 0);

ALTER TABLE "Resource" ADD CONSTRAINT "Resource_kind_valid" CHECK (kind IN ('FILE', 'FOLDER'));
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_status_valid" CHECK (status IN ('RESERVED', 'ACTIVE', 'UNAVAILABLE', 'DELETING'));
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_root_shape" CHECK (
  ("isRoot" AND "parentId" IS NULL AND kind = 'FOLDER' AND status = 'ACTIVE') OR
  (NOT "isRoot" AND "parentId" IS NOT NULL)
);
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_name_valid" CHECK (char_length(name) BETWEEN 1 AND 120);
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_folder_metadata" CHECK (
  kind <> 'FOLDER' OR (size IS NULL AND "mimeType" IS NULL AND sha256 IS NULL AND "objectKey" IS NULL)
);
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_active_file_metadata" CHECK (
  kind <> 'FILE' OR status <> 'ACTIVE' OR
  (size >= 0 AND "mimeType" IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$' AND "objectKey" IS NOT NULL)
);
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_deletion_link" CHECK (status <> 'DELETING' OR "deletionId" IS NOT NULL);
CREATE UNIQUE INDEX "Resource_one_root_per_owner" ON "Resource"("ownerId") WHERE "isRoot";

ALTER TABLE "Share" ADD CONSTRAINT "Share_permission_valid" CHECK (permission IN ('READ', 'EDIT'));
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_status_valid" CHECK (
  status IN ('CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED')
);
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_bytes_valid" CHECK (
  "expectedSize" >= 0 AND "receivedBytes" >= 0 AND "receivedBytes" <= "expectedSize"
);
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_attempt_valid" CHECK ("attemptCount" BETWEEN 0 AND 3);
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_lease_valid" CHECK (
  status <> 'PROCESSING' OR ("attemptId" IS NOT NULL AND "leaseUntil" IS NOT NULL)
);
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_resource_ref_valid" CHECK ("resourceRefId" IS NULL OR "resourceRefId" = "resourceId");
ALTER TABLE "UploadAttempt" ADD CONSTRAINT "UploadAttempt_status_valid" CHECK (status IN ('WRITING', 'PUBLISHED', 'DISCARDED', 'CLEANED'));
ALTER TABLE "Deletion" ADD CONSTRAINT "Deletion_status_valid" CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'));
ALTER TABLE "Deletion" ADD CONSTRAINT "Deletion_progress_valid" CHECK (
  "affectedResources" >= 0 AND "processedResources" BETWEEN 0 AND "affectedResources" AND "attemptCount" >= 0
);
ALTER TABLE "Outbox" ADD CONSTRAINT "Outbox_message_valid" CHECK (
  type IN ('UPLOAD', 'DELETE') AND version = 1 AND "publishAttempts" >= 0
);
CREATE INDEX "Outbox_pending" ON "Outbox"("availableAt", "createdAt", id) WHERE "publishedAt" IS NULL;

CREATE FUNCTION guard_resource_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_kind text; parent_status text; parent_root boolean; depth int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."ownerId" <> NEW."ownerId" OR OLD."parentId" IS DISTINCT FROM NEW."parentId" OR OLD."isRoot" <> NEW."isRoot" THEN
      RAISE EXCEPTION 'La propiedad y ubicación del recurso son inmutables';
    END IF;
    IF OLD."isRoot" AND (OLD.name <> NEW.name OR OLD.status <> NEW.status) THEN
      RAISE EXCEPTION 'La raíz está protegida';
    END IF;
  END IF;
  IF NOT NEW."isRoot" AND (TG_OP = 'INSERT' OR OLD."parentId" IS DISTINCT FROM NEW."parentId") THEN
    SELECT kind, status, "isRoot" INTO parent_kind, parent_status, parent_root
      FROM "Resource" WHERE id = NEW."parentId";
    IF parent_kind <> 'FOLDER' OR parent_status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'El padre debe ser una carpeta activa';
    END IF;
    WITH RECURSIVE ancestors AS (
      SELECT id, "parentId", 1 AS level FROM "Resource" WHERE id = NEW."parentId"
      UNION ALL
      SELECT r.id, r."parentId", a.level + 1 FROM "Resource" r JOIN ancestors a ON r.id = a."parentId"
    ) SELECT max(level) INTO depth FROM ancestors;
    IF depth > 10 THEN RAISE EXCEPTION 'Profundidad máxima excedida'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_write_guard BEFORE INSERT OR UPDATE ON "Resource"
  FOR EACH ROW EXECUTE FUNCTION guard_resource_write();

CREATE FUNCTION guard_root_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isRoot" THEN RAISE EXCEPTION 'La raíz está protegida'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER resource_root_delete_guard BEFORE DELETE ON "Resource"
  FOR EACH ROW EXECUTE FUNCTION guard_root_delete();
