import type { NodeExecutor } from "../types";

/**
 * Trigger nodes are the entry point of a workflow. Whatever launched the run
 * (a manual click, an inbound webhook, or a schedule fire) put its data in the
 * run's trigger payload; a trigger node simply passes that payload through as
 * its output, so downstream nodes can reference `{{<triggerNodeId>.field}}`
 * (or the equivalent `{{trigger.field}}`).
 */
function passthroughTrigger(type: string): NodeExecutor {
  return {
    type,
    async execute(_node, _input, context) {
      return context.trigger ?? null;
    },
  };
}

export const manualTriggerExecutor: NodeExecutor = passthroughTrigger("trigger.manual");
export const webhookTriggerExecutor: NodeExecutor = passthroughTrigger("trigger.webhook");
export const scheduleTriggerExecutor: NodeExecutor = passthroughTrigger("trigger.schedule");
