DROP INDEX "Outbox_type_entityId_version_key";
ALTER TABLE "UploadAttempt" ADD COLUMN "failureCode" TEXT;
CREATE INDEX "Outbox_type_entityId_publishedAt_idx" ON "Outbox"("type","entityId","publishedAt");

CREATE TABLE "QueueObservation" (
  id UUID NOT NULL,
  "messageId" TEXT NOT NULL,
  "uploadId" UUID,
  source TEXT NOT NULL,
  "receiveCount" INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  "observedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QueueObservation_pkey" PRIMARY KEY (id),
  CONSTRAINT "QueueObservation_valid" CHECK (
    source IN ('MAIN','DLQ') AND "receiveCount" > 0
    AND outcome IN ('RECEIVED','ACKED','RETRY','INVALID','RECOVERED','DEFERRED','ACTIVE','TERMINAL'))
);
CREATE UNIQUE INDEX "QueueObservation_source_messageId_receiveCount_key"
  ON "QueueObservation"(source,"messageId","receiveCount");
CREATE INDEX "QueueObservation_uploadId_observedAt_idx"
  ON "QueueObservation"("uploadId","observedAt");
