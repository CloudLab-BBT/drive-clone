-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "reservedBytes" BIGINT NOT NULL DEFAULT 0,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" UUID,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "parentId" UUID,
    "kind" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "nameKey" TEXT NOT NULL,
    "isRoot" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "size" BIGINT,
    "mimeType" TEXT,
    "sha256" CHAR(64),
    "objectKey" TEXT,
    "deletionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Share" (
    "resourceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Share_pkey" PRIMARY KEY ("resourceId","userId")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "resourceRefId" UUID,
    "status" TEXT NOT NULL,
    "expectedSize" BIGINT NOT NULL,
    "receivedBytes" BIGINT NOT NULL DEFAULT 0,
    "tempKey" TEXT,
    "sha256" CHAR(64),
    "attemptId" UUID,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMPTZ(6),
    "nextAttemptAt" TIMESTAMPTZ(6),
    "cancelRequestedAt" TIMESTAMPTZ(6),
    "errorCode" TEXT,
    "cleanupPending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadAttempt" (
    "id" UUID NOT NULL,
    "uploadId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UploadAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deletion" (
    "id" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "affectedResources" INTEGER NOT NULL,
    "processedResources" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "attemptId" UUID,
    "leaseUntil" TIMESTAMPTZ(6),
    "nextAttemptAt" TIMESTAMPTZ(6),
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Deletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "publishAttempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(6),
    "attemptId" UUID,
    "leaseUntil" TIMESTAMPTZ(6),
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

