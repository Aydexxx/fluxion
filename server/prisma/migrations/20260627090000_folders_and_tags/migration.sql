-- Workflow organization at scale: flat per-workspace folders + many-to-many tags.

-- 1. Folder (flat — no nesting).
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Folder_workspaceId_idx" ON "Folder"("workspaceId");

ALTER TABLE "Folder"
  ADD CONSTRAINT "Folder_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Tag (name normalized trimmed+lowercased by the application before insert).
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tag_workspaceId_name_key" ON "Tag"("workspaceId", "name");
CREATE INDEX "Tag_workspaceId_idx" ON "Tag"("workspaceId");

ALTER TABLE "Tag"
  ADD CONSTRAINT "Tag_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. WorkflowTag join table.
CREATE TABLE "WorkflowTag" (
    "workflowId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "WorkflowTag_pkey" PRIMARY KEY ("workflowId","tagId")
);

CREATE INDEX "WorkflowTag_tagId_idx" ON "WorkflowTag"("tagId");

ALTER TABLE "WorkflowTag"
  ADD CONSTRAINT "WorkflowTag_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowTag"
  ADD CONSTRAINT "WorkflowTag_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Workflow gains an optional folder.
ALTER TABLE "Workflow" ADD COLUMN "folderId" TEXT;

CREATE INDEX "Workflow_folderId_idx" ON "Workflow"("folderId");

ALTER TABLE "Workflow"
  ADD CONSTRAINT "Workflow_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
