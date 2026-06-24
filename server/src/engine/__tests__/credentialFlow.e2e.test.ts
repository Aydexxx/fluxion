import { describe, expect, it, vi } from "vitest";
import { runWorkflow } from "../runWorkflow";
import { createDefaultRegistry } from "../registry";
import { InMemoryRunRecorder } from "../persistence";
import { encryptSecret, decryptSecret, loadEncryptionKey } from "../../services/crypto";
import type { CredentialAccessor, EmailSender, LlmSettings } from "../types";
import type { WorkflowDefinition } from "../../dag/types";

const llm: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

const WEBHOOK_URL = "https://hooks.slack.com/services/SECRET-WEBHOOK";
const SMTP_PASSWORD = "smtp-secret-pw";

/**
 * A credential accessor that decrypts from an encrypted blob — exercising the
 * real crypto path (encrypt at rest, decrypt at execution) without a database.
 */
function encryptedAccessor(): CredentialAccessor {
  const key = loadEncryptionKey("Ov7Z9RtjhZKnmPXQRoSPCwtGeTK8ellFXcOQZzMu4oA=");
  const store: Record<string, { type: string; blob: string }> = {
    smtp1: {
      type: "smtp",
      blob: encryptSecret(JSON.stringify({ host: "smtp.x.com", port: "587", username: "u", password: SMTP_PASSWORD, from: "bot@x.com" }), key),
    },
    slack1: { type: "slack_webhook", blob: encryptSecret(JSON.stringify({ url: WEBHOOK_URL }), key) },
  };
  return {
    async resolve(id) {
      const row = store[id];
      if (!row) return null;
      return { type: row.type, data: JSON.parse(decryptSecret(row.blob, key)) as Record<string, string> };
    },
  };
}

describe("end-to-end: credential + filter + loop + email + slack", () => {
  it("runs a full flow and never leaks secrets into run outputs", async () => {
    const sentEmails: Array<{ to: string; subject: string }> = [];
    const email: EmailSender = {
      async send(_smtp, message) {
        sentEmails.push({ to: message.to, subject: message.subject });
        return { messageId: "msg_e2e", accepted: [message.to] };
      },
    };
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));

    const definition: WorkflowDefinition = {
      nodes: [
        { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
        // keep only active users
        { id: "f", type: "logic.filter", position: { x: 0, y: 0 }, config: { items: "{{trigger.users}}", field: "active", operator: "truthy" } },
        // iterate the kept users into a list of emails
        { id: "l", type: "logic.loop", position: { x: 0, y: 0 }, config: { items: "{{f.items}}", fields: [{ as: "email", path: "email" }] } },
        // email an admin, using the SMTP credential
        {
          id: "m",
          type: "action.email",
          position: { x: 0, y: 0 },
          config: { credentialId: "smtp1", to: "admin@x.com", subject: "Report: {{trigger.topic}}", text: "Active users: {{f.count}}" },
        },
        // post a summary to Slack, using the webhook credential
        { id: "s", type: "action.slack", position: { x: 0, y: 0 }, config: { credentialId: "slack1", text: "Sent {{f.count}} reports for {{trigger.topic}}" } },
        { id: "out", type: "output.response", position: { x: 0, y: 0 }, config: { body: { emailed: "{{m.messageId}}", count: "{{f.count}}", recipients: "{{l.items}}" } } },
      ],
      edges: [
        { id: "e1", source: "t", target: "f" },
        { id: "e2", source: "f", target: "l" },
        { id: "e3", source: "f", target: "m" },
        { id: "e4", source: "f", target: "s" },
        { id: "e5", source: "m", target: "out" },
        { id: "e6", source: "s", target: "out" },
        { id: "e7", source: "l", target: "out" },
      ],
    };

    const recorder = new InMemoryRunRecorder();
    const payload = {
      topic: "weekly",
      users: [
        { email: "a@x.com", active: true },
        { email: "b@x.com", active: false },
        { email: "c@x.com", active: true },
      ],
    };
    const runId = await recorder.enqueueRun({ workflowId: "wf", trigger: "manual", payload });

    const result = await runWorkflow({
      runId,
      workflowId: "wf",
      workspaceId: "ws",
      definition,
      trigger: { type: "manual", payload },
      registry: createDefaultRegistry(),
      recorder,
      llm,
      credentials: encryptedAccessor(),
      email,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.status).toBe("success");

    // filter kept 2 active users; loop projected their emails
    const loopOut = result.nodeExecutions.find((n) => n.nodeId === "l")?.output as { items: unknown[]; count: number };
    expect(loopOut).toEqual({ items: [{ email: "a@x.com" }, { email: "c@x.com" }], count: 2, isEmpty: false });

    // email sent through the SMTP credential
    expect(sentEmails).toEqual([{ to: "admin@x.com", subject: "Report: weekly" }]);

    // slack posted to the decrypted webhook URL with the templated summary
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);
    expect(JSON.parse(init.body as string)).toEqual({ text: "Sent 2 reports for weekly" });

    // final response assembled from upstream outputs
    expect(result.nodeExecutions.find((n) => n.nodeId === "out")?.output).toEqual({
      body: { emailed: "msg_e2e", count: 2, recipients: [{ email: "a@x.com" }, { email: "c@x.com" }] },
    });

    // CRITICAL: no decrypted secret ever lands in the persisted run record.
    const persisted = JSON.stringify(result);
    expect(persisted).not.toContain(SMTP_PASSWORD);
    expect(persisted).not.toContain(WEBHOOK_URL);
  });
});
