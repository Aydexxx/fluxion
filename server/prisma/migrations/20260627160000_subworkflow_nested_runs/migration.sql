-- Nested sub-workflow runs: a WorkflowRun can be spawned by a `flow.subworkflow`
-- node in a parent run. Link the child back to its parent run (and the calling
-- node) so run history can render the nesting and lineage.

ALTER TABLE "WorkflowRun" ADD COLUMN "parentRunId" TEXT;
ALTER TABLE "WorkflowRun" ADD COLUMN "parentNodeId" TEXT;

CREATE INDEX "WorkflowRun_parentRunId_idx" ON "WorkflowRun"("parentRunId");

-- Deleting a parent run cascades to its nested runs (they have no standalone meaning).
ALTER TABLE "WorkflowRun"
  ADD CONSTRAINT "WorkflowRun_parentRunId_fkey"
  FOREIGN KEY ("parentRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
