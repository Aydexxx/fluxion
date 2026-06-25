-- Workflow-level failure-alert config: { channel, credentialId, to? }. Null = no alerts.
ALTER TABLE "Workflow" ADD COLUMN "failureNotify" JSONB;
