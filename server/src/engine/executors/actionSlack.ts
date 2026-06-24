import type { NodeExecutor } from "../types";
import { resolveCredential } from "./credentialUtil";

interface SlackConfig {
  credentialId?: string;
  text?: string;
}

export interface SlackOutput {
  ok: boolean;
  status: number;
}

/**
 * Posts a message to a Slack or Discord incoming webhook. The webhook URL is a
 * secret, so it comes from a `slack_webhook` credential (resolved at execution
 * time) rather than the node config. Slack and Discord differ only in the JSON
 * key for the message body (`text` vs `content`), inferred from the URL.
 */
export const slackExecutor: NodeExecutor = {
  type: "action.slack",
  async execute(node, _input, context): Promise<SlackOutput> {
    const config = node.config as SlackConfig;
    const text = typeof config.text === "string" ? config.text : "";

    const { data } = await resolveCredential(context, config.credentialId, "slack_webhook");
    const url = data.url;
    if (!url) throw new Error("slack_webhook credential is missing its url");

    const isDiscord = url.includes("discord");
    const body = JSON.stringify(isDiscord ? { content: text } : { text });
    const res = await context.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!res.ok) {
      throw new Error(`Slack/Discord webhook responded with status ${res.status}`);
    }
    return { ok: true, status: res.status };
  },
};
