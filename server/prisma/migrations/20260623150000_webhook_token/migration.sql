-- Add unguessable webhook token for inbound webhook triggers.
ALTER TABLE "Workflow" ADD COLUMN "webhookToken" TEXT;

CREATE UNIQUE INDEX "Workflow_webhookToken_key" ON "Workflow"("webhookToken");
