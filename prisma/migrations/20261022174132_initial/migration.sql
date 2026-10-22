-- CreateTable
CREATE TABLE "User" (
    "uid" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "maxDepth" INTEGER NOT NULL DEFAULT 0,
    "progressVersion" INTEGER NOT NULL DEFAULT 0,
    "facts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("uid")
);

-- CreateTable
CREATE TABLE "Session" (
    "hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "uid" UUID,
    "csrf" TEXT NOT NULL,
    "epoch" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "ui" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pack" (
    "version" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "archiveKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pack_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "ActiveContent" (
    "id" INTEGER NOT NULL,
    "version" TEXT NOT NULL,

    CONSTRAINT "ActiveContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "hash" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "digest" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "members" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "runId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" UUID NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "runId" UUID NOT NULL,
    "uid" UUID NOT NULL,
    "countedKills" INTEGER NOT NULL DEFAULT 0,
    "countedDeath" BOOLEAN NOT NULL DEFAULT false,
    "canResume" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("runId","uid")
);

-- CreateTable
CREATE TABLE "Unlock" (
    "uid" UUID NOT NULL,
    "characterId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Unlock_pkey" PRIMARY KEY ("uid","characterId")
);

-- CreateTable
CREATE TABLE "ProgressEvent" (
    "id" TEXT NOT NULL,
    "uid" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressReset" (
    "id" TEXT NOT NULL,
    "uid" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_kills_idx" ON "User"("kills" DESC);

-- CreateIndex
CREATE INDEX "User_maxDepth_idx" ON "User"("maxDepth" DESC);

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Pack_hash_key" ON "Pack"("hash");

-- CreateIndex
CREATE INDEX "Asset_hash_idx" ON "Asset"("hash");

-- CreateIndex
CREATE INDEX "Audit_createdAt_idx" ON "Audit"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Room_runId_key" ON "Room"("runId");

-- CreateIndex
CREATE INDEX "ProgressEvent_uid_runId_idx" ON "ProgressEvent"("uid", "runId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_uid_fkey" FOREIGN KEY ("uid") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_contentVersion_fkey" FOREIGN KEY ("contentVersion") REFERENCES "Pack"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_uid_fkey" FOREIGN KEY ("uid") REFERENCES "User"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unlock" ADD CONSTRAINT "Unlock_uid_fkey" FOREIGN KEY ("uid") REFERENCES "User"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEvent" ADD CONSTRAINT "ProgressEvent_uid_fkey" FOREIGN KEY ("uid") REFERENCES "User"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEvent" ADD CONSTRAINT "ProgressEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressReset" ADD CONSTRAINT "ProgressReset_uid_fkey" FOREIGN KEY ("uid") REFERENCES "User"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
