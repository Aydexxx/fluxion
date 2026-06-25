-- Draft/published split + immutable version history + per-run definition snapshot.

-- 1. Split Workflow.definition into a draft (edited) and published (runs in prod) pair.
--    Existing workflows are treated as already-published as-is, so both copies start
--    equal to the current definition — nothing changes about what they run today.
ALTER TABLE "Workflow" ADD COLUMN "draftDefinition" JSONB;
ALTER TABLE "Workflow" ADD COLUMN "publishedDefinition" JSONB;

UPDATE "Workflow" SET "draftDefinition" = "definition", "publishedDefinition" = "definition";

ALTER TABLE "Workflow" ALTER COLUMN "draftDefinition" SET NOT NULL;
ALTER TABLE "Workflow" DROP COLUMN "definition";

-- 2. Version history table.
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "authorId" TEXT,
    "authorName" TEXT,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");
CREATE INDEX "WorkflowVersion_workflowId_idx" ON "WorkflowVersion"("workflowId");

ALTER TABLE "WorkflowVersion"
  ADD CONSTRAINT "WorkflowVersion_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Seed an initial v1 for every existing workflow so each has a published history
--    entry to roll back to. cuid-shaped ids aren't required for migration rows.
INSERT INTO "WorkflowVersion" ("id", "workflowId", "version", "name", "note", "authorId", "authorName", "definition", "createdAt")
SELECT 'wfv1_' || "id", "id", 1, "name", 'Initial version', NULL, NULL, "publishedDefinition", CURRENT_TIMESTAMP
FROM "Workflow";

-- 4. Per-run definition snapshot. Nullable: historical runs have none and never re-execute.
ALTER TABLE "WorkflowRun" ADD COLUMN "definition" JSONB;
