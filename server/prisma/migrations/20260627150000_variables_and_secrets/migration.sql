-- Reusable workspace-level variables (plain) and secrets (encrypted at rest),
-- referenceable in node configs via {{ vars.KEY }} / {{ secrets.KEY }}.

-- 1. WorkspaceVariable — plain values, returned to the client as-is.
CREATE TABLE "WorkspaceVariable" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceVariable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceVariable_workspaceId_key_key" ON "WorkspaceVariable"("workspaceId", "key");
CREATE INDEX "WorkspaceVariable_workspaceId_idx" ON "WorkspaceVariable"("workspaceId");

ALTER TABLE "WorkspaceVariable"
  ADD CONSTRAINT "WorkspaceVariable_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. WorkspaceSecret — AES-256-GCM encrypted; value never returned to the client.
CREATE TABLE "WorkspaceSecret" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceSecret_workspaceId_key_key" ON "WorkspaceSecret"("workspaceId", "key");
CREATE INDEX "WorkspaceSecret_workspaceId_idx" ON "WorkspaceSecret"("workspaceId");

ALTER TABLE "WorkspaceSecret"
  ADD CONSTRAINT "WorkspaceSecret_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
