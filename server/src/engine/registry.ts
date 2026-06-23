import type { NodeExecutor } from "./types";
import { manualTriggerExecutor, scheduleTriggerExecutor, webhookTriggerExecutor } from "./executors/triggerManual";
import { httpExecutor } from "./executors/actionHttp";
import { transformExecutor } from "./executors/actionTransform";
import { conditionExecutor } from "./executors/logicCondition";
import { llmExecutor } from "./executors/aiLlm";
import { outputResponseExecutor } from "./executors/outputResponse";

/**
 * Maps a node `type` to the executor that runs it. The registry is the single
 * extension point of the engine: supporting a new node type is one
 * `registry.register(myExecutor)` call and nothing else — the orchestrator,
 * persistence, and API are all type-agnostic.
 */
export class NodeExecutorRegistry {
  private readonly executors = new Map<string, NodeExecutor>();

  register(executor: NodeExecutor): this {
    this.executors.set(executor.type, executor);
    return this;
  }

  get(type: string): NodeExecutor | undefined {
    return this.executors.get(type);
  }

  has(type: string): boolean {
    return this.executors.has(type);
  }

  /** The node types this registry can execute (useful for diagnostics). */
  types(): string[] {
    return [...this.executors.keys()];
  }
}

/** Registry pre-loaded with the built-in executors that ship with the platform. */
export function createDefaultRegistry(): NodeExecutorRegistry {
  return new NodeExecutorRegistry()
    .register(manualTriggerExecutor)
    .register(webhookTriggerExecutor)
    .register(scheduleTriggerExecutor)
    .register(httpExecutor)
    .register(transformExecutor)
    .register(conditionExecutor)
    .register(llmExecutor)
    .register(outputResponseExecutor);
}
