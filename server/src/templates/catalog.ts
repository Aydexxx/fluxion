import type { WorkflowDefinition } from "../dag/types";

/**
 * A prebuilt, ready-to-explore workflow. Templates are stored as plain
 * definitions here (not hardcoded in the UI) so the same data drives the
 * gallery cards, the "Use template" instantiation, and the tests.
 *
 * Node titles live under the reserved `__title` config key — the same place the
 * editor persists them (see web `graph.ts`) — so an instantiated template opens
 * with friendly, human node names. Sample outputs are pinned via `pinnedData`
 * so downstream references resolve immediately for single-node tests and the
 * design-time data picker, making a freshly-used template feel alive on first
 * open rather than inert.
 */
export interface WorkflowTemplate {
  /** Stable slug used in the gallery and the instantiate URL. */
  id: string;
  name: string;
  description: string;
  /** One-word vibe shown as a chip on the card. */
  category: string;
  definition: WorkflowDefinition;
}

/** Reserved config key the editor folds a node's display title into. */
const TITLE = "__title";

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "webhook-ai-discord",
    name: "Webhook → AI summary → Discord",
    description:
      "Catch an inbound webhook, summarize its payload with an AI model, and post the digest to a Discord or Slack channel.",
    category: "AI",
    definition: {
      nodes: [
        {
          id: "trigger",
          type: "trigger.webhook",
          position: { x: 0, y: 120 },
          config: { [TITLE]: "Inbound webhook" },
          pinnedData: {
            body: {
              ticket: "SUP-2481",
              customer: "Ada Lovelace",
              message: "The export button throws a 500 when I have more than 10k rows selected.",
            },
            headers: { "content-type": "application/json" },
            query: {},
          },
        },
        {
          id: "summarize",
          type: "ai.llm",
          position: { x: 300, y: 120 },
          config: {
            provider: "none",
            model: "llama3",
            prompt:
              "Summarize this support ticket in one sentence, then suggest a priority (low/medium/high):\n\n{{ trigger.body.message }}",
            [TITLE]: "Summarize ticket",
          },
        },
        {
          id: "notify",
          type: "action.slack",
          position: { x: 600, y: 120 },
          config: {
            credentialId: "",
            text: "🆕 *New ticket* {{ trigger.body.ticket }}\n{{ summarize.text }}",
            [TITLE]: "Notify Discord",
          },
          pinnedData: { ok: true, status: 204 },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "summarize" },
        { id: "e2", source: "summarize", target: "notify" },
      ],
    },
  },

  {
    id: "daily-digest-email",
    name: "Daily digest email",
    description:
      "On a daily schedule, fetch metrics over HTTP, reshape them into a tidy summary, and email the digest to your team.",
    category: "Schedule",
    definition: {
      nodes: [
        {
          id: "schedule",
          type: "trigger.schedule",
          position: { x: 0, y: 140 },
          config: { cron: "0 9 * * *", [TITLE]: "Every day at 9am" },
          pinnedData: { firedAt: "2026-06-25T09:00:00.000Z" },
        },
        {
          id: "fetch",
          type: "action.http",
          position: { x: 290, y: 140 },
          config: {
            method: "GET",
            url: "https://api.example.com/metrics/daily",
            headers: "",
            body: "",
            [TITLE]: "Fetch daily metrics",
          },
          pinnedData: {
            status: 200,
            body: { signups: 128, revenue: 4210, topReferrer: "producthunt" },
          },
        },
        {
          id: "shape",
          type: "action.transform",
          position: { x: 580, y: 140 },
          config: {
            mappings: [
              { key: "signups", value: "{{ fetch.body.signups }}" },
              { key: "revenue", value: "{{ fetch.body.revenue }}" },
              { key: "topReferrer", value: "{{ fetch.body.topReferrer }}" },
            ],
            [TITLE]: "Shape digest",
          },
        },
        {
          id: "email",
          type: "action.email",
          position: { x: 870, y: 140 },
          config: {
            credentialId: "",
            to: "team@example.com",
            subject: "Your daily digest",
            text: "Signups: {{ shape.signups }}\nRevenue: ${{ shape.revenue }}\nTop referrer: {{ shape.topReferrer }}",
            [TITLE]: "Email the team",
          },
          pinnedData: { messageId: "stub-message-id", accepted: ["team@example.com"] },
        },
      ],
      edges: [
        { id: "e1", source: "schedule", target: "fetch" },
        { id: "e2", source: "fetch", target: "shape" },
        { id: "e3", source: "shape", target: "email" },
      ],
    },
  },

  {
    id: "research-agent-slack",
    name: "AI research agent → Slack",
    description:
      "Kick off an AI agent that researches a question against your knowledge base, format its answer, and share it in Slack.",
    category: "Agent",
    definition: {
      nodes: [
        {
          id: "trigger",
          type: "trigger.manual",
          position: { x: 0, y: 140 },
          config: { [TITLE]: "Start research" },
          pinnedData: { question: "What is our refund policy for annual plans?" },
        },
        {
          id: "agent",
          type: "ai.agent",
          position: { x: 290, y: 140 },
          config: {
            provider: "none",
            model: "",
            goal: "Research and answer the customer question: {{ trigger.question }}",
            tools: ["rag_search"],
            knowledge: [
              "Refunds are processed within 5 business days.",
              "Customers can request a refund within 30 days of purchase.",
              "Annual plans are refundable on a prorated basis after the first 30 days.",
            ],
            maxSteps: 4,
            [TITLE]: "Research agent",
          },
        },
        {
          id: "format",
          type: "action.transform",
          position: { x: 580, y: 140 },
          config: {
            mappings: [{ key: "answer", value: "{{ agent.answer }}" }],
            [TITLE]: "Format answer",
          },
        },
        {
          id: "post",
          type: "action.slack",
          position: { x: 870, y: 140 },
          config: {
            credentialId: "",
            text: "🔎 Research result:\n{{ format.answer }}",
            [TITLE]: "Post to Slack",
          },
          pinnedData: { ok: true, status: 200 },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "agent" },
        { id: "e2", source: "agent", target: "format" },
        { id: "e3", source: "format", target: "post" },
      ],
    },
  },

  {
    id: "webhook-branch",
    name: "Webhook → branch → two outcomes",
    description:
      "Route an inbound event down one of two paths with a condition: high-value orders alert a channel, everything else is logged.",
    category: "Logic",
    definition: {
      nodes: [
        {
          id: "trigger",
          type: "trigger.webhook",
          position: { x: 0, y: 160 },
          config: { [TITLE]: "Inbound order" },
          pinnedData: { body: { orderId: "ORD-7782", amount: 250, currency: "USD" }, headers: {}, query: {} },
        },
        {
          id: "check",
          type: "logic.condition",
          position: { x: 300, y: 160 },
          config: { expression: "{{ trigger.body.amount }} >= 100", [TITLE]: "High value?" },
        },
        {
          id: "vip",
          type: "action.slack",
          position: { x: 620, y: 60 },
          config: {
            credentialId: "",
            text: "💎 High-value order {{ trigger.body.orderId }} — {{ trigger.body.amount }} {{ trigger.body.currency }}",
            [TITLE]: "Alert VIP channel",
          },
          pinnedData: { ok: true, status: 200 },
        },
        {
          id: "log",
          type: "output.response",
          position: { x: 620, y: 260 },
          config: { body: '{\n  "logged": true,\n  "orderId": "{{ trigger.body.orderId }}"\n}', [TITLE]: "Log & finish" },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "check" },
        { id: "e2", source: "check", target: "vip", sourceHandle: "true" },
        { id: "e3", source: "check", target: "log", sourceHandle: "false" },
      ],
    },
  },
];

/** The unique node types used by a template, in first-appearance order, for gallery chips. */
export function templateNodeTypes(template: WorkflowTemplate): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const node of template.definition.nodes) {
    if (seen.has(node.type)) continue;
    seen.add(node.type);
    ordered.push(node.type);
  }
  return ordered;
}

export function findTemplate(id: string): WorkflowTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
