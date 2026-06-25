import type { Request, Response } from "express";
import { prisma } from "../services/prisma";
import { enqueueRunForWorkflow } from "../services/runs";

/**
 * Inbound webhook trigger: `POST /webhooks/:token`.
 *
 * Looks up the workflow by its unguessable token, and — only if it's active —
 * enqueues a run with the request body/headers/query as the trigger payload.
 * Returns fast (202) without executing inline; the worker runs it. Unknown
 * tokens 404; inactive workflows are accepted but not fired.
 */
export async function handleWebhook(req: Request<{ token: string }>, res: Response): Promise<void> {
  const workflow = await prisma.workflow.findUnique({
    where: { webhookToken: req.params.token },
    select: { id: true, isActive: true, publishedDefinition: true },
  });

  if (!workflow) {
    res.status(404).json({ error: { message: "Unknown webhook", code: "NOT_FOUND" } });
    return;
  }

  if (!workflow.isActive) {
    res.status(200).json({ accepted: false, reason: "workflow_inactive" });
    return;
  }

  // Webhooks run the published version; a workflow that's never been published
  // (or only has draft edits) has nothing to run, so we accept-but-don't-fire.
  if (workflow.publishedDefinition == null) {
    res.status(200).json({ accepted: false, reason: "workflow_unpublished" });
    return;
  }

  const payload = {
    body: req.body ?? null,
    headers: req.headers,
    query: req.query,
  };

  const run = await enqueueRunForWorkflow(workflow.id, "webhook", payload);
  res.status(202).json({ accepted: true, runId: run.id });
}
