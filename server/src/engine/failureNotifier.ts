import type { WorkflowNode } from "../dag/types";
import { slackExecutor } from "./executors/actionSlack";
import { emailExecutor } from "./executors/actionEmail";
import type { CredentialAccessor, EmailSender, ExecutionContext, LlmSettings } from "./types";

/** Per-workflow failure-alert configuration, persisted on the workflow. */
export interface FailureNotifyConfig {
  channel: "slack" | "email";
  /** Credential to send through: a `slack_webhook` for slack, an `smtp` for email. */
  credentialId: string;
  /** Recipient address — email only. */
  to?: string;
}

/** Narrows arbitrary stored JSON into a usable FailureNotifyConfig, or null if unset/invalid. */
export function parseFailureNotify(value: unknown): FailureNotifyConfig | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const channel = v.channel;
  if (channel !== "slack" && channel !== "email") return null;
  if (typeof v.credentialId !== "string" || v.credentialId.trim() === "") return null;
  const to = typeof v.to === "string" ? v.to : undefined;
  if (channel === "email" && (!to || to.trim() === "")) return null;
  return { channel, credentialId: v.credentialId, to };
}

/** The minimal run facts a failure alert reports. */
export interface RunFailureSummary {
  runId: string;
  workflowName: string;
  failingNodeId: string | null;
  error: string | null;
}

/** A concise, human alert body shared by both channels. */
export function buildFailureMessage(run: RunFailureSummary): string {
  const at = run.failingNodeId ? ` at node "${run.failingNodeId}"` : "";
  const reason = run.error ? `\n${run.error}` : "";
  return `🚨 Workflow "${run.workflowName}" failed${at}.\nRun ${run.runId}${reason}`;
}

// Executors require an `llm` on the context they never read; a stub satisfies the type.
const STUB_LLM: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "",
  ollamaModel: "",
  openaiBaseUrl: "",
  openaiModel: "",
};

/**
 * Sends a failure alert by reusing the very same Slack/email node executors a
 * workflow would — so a notification is delivered, resolved and retried exactly
 * like any other action, with the credential decrypted at send time.
 */
export async function sendFailureNotification(params: {
  notify: FailureNotifyConfig;
  run: RunFailureSummary;
  workspaceId: string;
  credentials: CredentialAccessor;
  fetchImpl?: typeof fetch;
  email?: EmailSender;
}): Promise<void> {
  const text = buildFailureMessage(params.run);
  const context: ExecutionContext = {
    workspaceId: params.workspaceId,
    trigger: null,
    credentials: params.credentials,
    llm: STUB_LLM,
    fetch: params.fetchImpl ?? globalThis.fetch,
    email: params.email,
  };
  const input = { trigger: null, sources: {} };

  if (params.notify.channel === "email") {
    const node: WorkflowNode = {
      id: "__failure_notify",
      type: "action.email",
      position: { x: 0, y: 0 },
      config: {
        credentialId: params.notify.credentialId,
        to: params.notify.to ?? "",
        subject: `Workflow failed: ${params.run.workflowName}`,
        text,
      },
    };
    await emailExecutor.execute(node, input, context);
    return;
  }

  const node: WorkflowNode = {
    id: "__failure_notify",
    type: "action.slack",
    position: { x: 0, y: 0 },
    config: { credentialId: params.notify.credentialId, text },
  };
  await slackExecutor.execute(node, input, context);
}
