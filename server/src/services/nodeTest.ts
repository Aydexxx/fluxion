import type { WorkflowDefinition } from "../dag/types";
import { env } from "../config/env";
import { createDefaultRegistry } from "../engine/registry";
import { runSingleNode, UnknownNodeError, type SingleNodeResult } from "../engine/runSingleNode";
import { nodemailerSender } from "../engine/clients/email";
import { pgQueryRunner } from "../engine/clients/db";
import { NotFoundError } from "../errors/HttpError";
import { prisma } from "./prisma";
import { requireWorkspaceRole, resolveWorkflowWorkspaceId } from "./authorization";
import { createPrismaCredentialAccessor } from "./credentials";
import type { TestNodeInput } from "../validation/workflow.schemas";

// The executor set is fixed; build it once and reuse across requests.
const registry = createDefaultRegistry();

/**
 * Executes a single node of a workflow in isolation, on the API process.
 *
 * Authorizes the caller as a workspace member (same bar as triggering a run),
 * loads the saved definition, and runs just the requested node through the shared
 * engine — reusing the real credential/email/db wiring so a test exercises the
 * node exactly as a production run would, but without traversing or persisting
 * the whole DAG. Pinned data on upstream nodes and the caller-supplied `sources`
 * provide the input context (see {@link runSingleNode}).
 */
export async function testWorkflowNode(
  workflowId: string,
  nodeId: string,
  userId: string,
  input: TestNodeInput,
): Promise<SingleNodeResult> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  await requireWorkspaceRole(workspaceId, userId, "member");

  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new NotFoundError("Workflow not found");
  const definition = workflow.definition as unknown as WorkflowDefinition;

  try {
    return await runSingleNode({
      workspaceId,
      definition,
      nodeId,
      configOverride: input.config,
      trigger: input.trigger,
      sources: input.sources,
      registry,
      llm: env.llm,
      // Secrets are resolved + decrypted here, scoped to the workflow's workspace.
      credentials: createPrismaCredentialAccessor(workspaceId),
      email: nodemailerSender,
      db: pgQueryRunner,
      limits: { httpTimeoutMs: env.nodeTimeouts.httpMs, aiTimeoutMs: env.nodeTimeouts.aiMs },
    });
  } catch (error) {
    if (error instanceof UnknownNodeError) throw new NotFoundError(error.message);
    throw error;
  }
}
