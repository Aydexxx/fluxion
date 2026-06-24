-- Run observability + replay lineage.
ALTER TABLE "WorkflowRun" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WorkflowRun" ADD COLUMN "replayOfId" TEXT;

CREATE INDEX "WorkflowRun_createdAt_idx" ON "WorkflowRun"("createdAt");
CREATE INDEX "WorkflowRun_replayOfId_idx" ON "WorkflowRun"("replayOfId");

ALTER TABLE "WorkflowRun"
  ADD CONSTRAINT "WorkflowRun_replayOfId_fkey"
  FOREIGN KEY ("replayOfId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
