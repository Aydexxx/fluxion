/**
 * Registry of known node types. Kept as a plain string list (not a Prisma/TS
 * enum) so new node types can be added here without a schema migration.
 */
export const NODE_TYPES = [
  "trigger.manual",
  "trigger.webhook",
  "trigger.schedule",
  "action.http",
  "action.transform",
  "action.email",
  "action.slack",
  "action.database",
  "ai.llm",
  "ai.agent",
  "ai.openai",
  "logic.condition",
  "logic.loop",
  "logic.filter",
  "flow.subworkflow",
  "action.github",
  "action.notion",
  "output.response",
] as const;

export type RegisteredNodeType = (typeof NODE_TYPES)[number];

const KNOWN_NODE_TYPES = new Set<string>(NODE_TYPES);

export function isKnownNodeType(type: string): boolean {
  return KNOWN_NODE_TYPES.has(type);
}

/** Trigger node types all share the `trigger.` namespace, so new ones (e.g. `trigger.schedule`) need no registry change. */
export function isTriggerNodeType(type: string): boolean {
  return type.startsWith("trigger.");
}
