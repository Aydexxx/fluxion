import type { NodeExecutor } from "../types";

interface OutputConfig {
  body?: unknown;
}

export interface ResponseOutput {
  body: unknown;
}

/**
 * Terminal node: collects the workflow's final result. `config.body` (already
 * template-resolved, so it can splice together upstream outputs) becomes the
 * response payload returned at the end of the run.
 */
export const outputResponseExecutor: NodeExecutor = {
  type: "output.response",
  async execute(node): Promise<ResponseOutput> {
    const config = node.config as OutputConfig;
    return { body: config.body ?? null };
  },
};
