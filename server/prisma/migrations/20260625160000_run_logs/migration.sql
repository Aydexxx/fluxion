-- Per-node retry count captured by the engine.
ALTER TABLE "NodeExecution" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1;

-- Structured, correlation-scoped run logs (streamed live, retained for the run view).
CREATE TABLE "RunLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "nodeId" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RunLog_runId_seq_idx" ON "RunLog"("runId", "seq");

ALTER TABLE "RunLog" ADD CONSTRAINT "RunLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keyset pagination index for the workspace runs list.
CREATE INDEX "WorkflowRun_createdAt_id_idx" ON "WorkflowRun"("createdAt", "id");
