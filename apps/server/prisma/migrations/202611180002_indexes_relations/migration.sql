-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_objectKey_key" ON "Resource"("objectKey");

-- CreateIndex
CREATE INDEX "Resource_parentId_createdAt_id_idx" ON "Resource"("parentId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Resource_ownerId_status_idx" ON "Resource"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Resource_deletionId_idx" ON "Resource"("deletionId");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_id_ownerId_key" ON "Resource"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_parentId_nameKey_key" ON "Resource"("parentId", "nameKey");

-- CreateIndex
CREATE INDEX "Share_userId_createdAt_resourceId_idx" ON "Share"("userId", "createdAt", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_resourceId_key" ON "Upload"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_resourceRefId_key" ON "Upload"("resourceRefId");

-- CreateIndex
CREATE INDEX "Upload_userId_status_createdAt_id_idx" ON "Upload"("userId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Upload_status_leaseUntil_idx" ON "Upload"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "Upload_status_nextAttemptAt_idx" ON "Upload"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadAttempt_objectKey_key" ON "UploadAttempt"("objectKey");

-- CreateIndex
CREATE INDEX "Deletion_ownerId_createdAt_id_idx" ON "Deletion"("ownerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Deletion_status_leaseUntil_idx" ON "Deletion"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "Outbox_availableAt_createdAt_id_idx" ON "Outbox"("availableAt", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Outbox_type_entityId_version_key" ON "Outbox"("type", "entityId", "version");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_parentId_ownerId_fkey" FOREIGN KEY ("parentId", "ownerId") REFERENCES "Resource"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_deletionId_fkey" FOREIGN KEY ("deletionId") REFERENCES "Deletion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_resourceRefId_fkey" FOREIGN KEY ("resourceRefId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadAttempt" ADD CONSTRAINT "UploadAttempt_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deletion" ADD CONSTRAINT "Deletion_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deletion" ADD CONSTRAINT "Deletion_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
