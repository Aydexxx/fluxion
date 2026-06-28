-- Programmatic access: scoped, revocable API keys per workspace, plus an `api`
-- run-trigger value so runs started through the public REST API are labelled
-- distinctly from manual/webhook/schedule runs.

-- 1. New RunTrigger enum value for API-initiated runs.
ALTER TYPE "RunTrigger" ADD VALUE 'api';

-- 2. ApiKey — only the SHA-256 hash of the secret is stored; the plaintext is
--    shown once at creation. `prefix` is a non-secret display slice.
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");
CREATE INDEX "ApiKey_workspaceId_idx" ON "ApiKey"("workspaceId");
CREATE INDEX "ApiKey_hashedKey_idx" ON "ApiKey"("hashedKey");

ALTER TABLE "ApiKey"
  ADD CONSTRAINT "ApiKey_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
