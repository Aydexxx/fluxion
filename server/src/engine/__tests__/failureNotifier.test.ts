import { describe, expect, it, vi } from "vitest";
import { buildFailureMessage, parseFailureNotify, sendFailureNotification } from "../failureNotifier";
import type { CredentialAccessor, CredentialSecret, EmailSender } from "../types";
import { handleJobFailure } from "../../worker/processRun";

function accessorFor(secret: CredentialSecret | null): CredentialAccessor {
  return { resolve: async () => secret };
}

const failingRun = {
  runId: "run_1",
  workflowName: "Nightly sync",
  failingNodeId: "http-fetch",
  error: "connection refused",
};

describe("parseFailureNotify", () => {
  it("accepts a valid slack config and a valid email config", () => {
    expect(parseFailureNotify({ channel: "slack", credentialId: "c1" })).toEqual({
      channel: "slack",
      credentialId: "c1",
      to: undefined,
    });
    expect(parseFailureNotify({ channel: "email", credentialId: "c2", to: "a@b.co" })).toEqual({
      channel: "email",
      credentialId: "c2",
      to: "a@b.co",
    });
  });

  it("rejects junk, missing credential, and email without a recipient", () => {
    expect(parseFailureNotify(null)).toBeNull();
    expect(parseFailureNotify({ channel: "sms", credentialId: "c1" })).toBeNull();
    expect(parseFailureNotify({ channel: "slack", credentialId: "" })).toBeNull();
    expect(parseFailureNotify({ channel: "email", credentialId: "c2" })).toBeNull();
  });
});

describe("buildFailureMessage", () => {
  it("names the workflow, failing node, run, and error", () => {
    const msg = buildFailureMessage(failingRun);
    expect(msg).toContain("Nightly sync");
    expect(msg).toContain('node "http-fetch"');
    expect(msg).toContain("run_1");
    expect(msg).toContain("connection refused");
  });
});

describe("sendFailureNotification — reuses the channel executors", () => {
  it("posts the alert to the Slack webhook", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    await sendFailureNotification({
      notify: { channel: "slack", credentialId: "slack-cred" },
      run: failingRun,
      workspaceId: "ws_1",
      credentials: accessorFor({ type: "slack_webhook", data: { url: "https://hooks.example.com/abc" } }),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/abc");
    const body = JSON.parse(String(init.body)) as { text: string };
    expect(body.text).toContain("Nightly sync");
    expect(body.text).toContain("connection refused");
  });

  it("sends the alert through the email transport", async () => {
    const send = vi.fn<EmailSender["send"]>(async () => ({ messageId: "m1", accepted: ["on-call@example.com"] }));
    const email: EmailSender = { send };
    await sendFailureNotification({
      notify: { channel: "email", credentialId: "smtp-cred", to: "on-call@example.com" },
      run: failingRun,
      workspaceId: "ws_1",
      credentials: accessorFor({ type: "smtp", data: { host: "smtp.example.com", from: "bot@example.com" } }),
      email,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const [, message] = send.mock.calls[0];
    expect(message.to).toBe("on-call@example.com");
    expect(message.text).toContain("connection refused");
  });
});

describe("handleJobFailure — fires the alert only on terminal failure", () => {
  const recorder = {
    finishRun: vi.fn(async () => {}),
    requeueRun: vi.fn(async () => {}),
  } as unknown as Parameters<typeof handleJobFailure>[0]["recorder"];

  it("invokes onTerminalFailure once retries are exhausted", async () => {
    const onTerminalFailure = vi.fn(async () => {});
    await handleJobFailure(
      { recorder, onTerminalFailure },
      { runId: "r1", attemptsMade: 3, maxAttempts: 3, error: new Error("boom") },
    );
    expect(onTerminalFailure).toHaveBeenCalledWith("r1");
  });

  it("does not notify (just requeues) while retries remain", async () => {
    const onTerminalFailure = vi.fn(async () => {});
    await handleJobFailure(
      { recorder, onTerminalFailure },
      { runId: "r2", attemptsMade: 1, maxAttempts: 3, error: new Error("boom") },
    );
    expect(onTerminalFailure).not.toHaveBeenCalled();
  });

  it("swallows a notifier error so the dead-letter is unaffected", async () => {
    const onTerminalFailure = vi.fn(async () => {
      throw new Error("notify failed");
    });
    await expect(
      handleJobFailure(
        { recorder, onTerminalFailure },
        { runId: "r3", attemptsMade: 3, maxAttempts: 3, error: new Error("boom") },
      ),
    ).resolves.toBeUndefined();
  });
});
