import type { NodeExecutor } from "../types";

interface ConditionConfig {
  expression?: string;
}

export interface ConditionOutput {
  result: boolean;
  /** Branch signal downstream edges can gate on via their `sourceHandle`. */
  branch: "true" | "false";
}

const COMPARATORS = ["==", "!=", ">=", "<=", ">", "<"] as const;
type Comparator = (typeof COMPARATORS)[number];

/**
 * Evaluates a simple boolean expression against the (already template-resolved)
 * config and emits a branch signal. Supported forms:
 *   - comparison: `lhs OP rhs` where OP is == != > < >= <=
 *     (numeric compare when both sides look numeric, else string compare)
 *   - truthiness: a bare value, e.g. `{{n1.ok}}` resolving to "true"/"false"/""
 *
 * No `eval` — this is a tiny hand-rolled parser, so configs can't execute code.
 * Downstream edges gate on `branch`: an edge with `sourceHandle: "false"` is
 * skipped when the condition is true, and vice versa.
 */
export const conditionExecutor: NodeExecutor = {
  type: "logic.condition",
  async execute(node): Promise<ConditionOutput> {
    const config = node.config as ConditionConfig;
    const expression = (config.expression ?? "").trim();
    const result = evaluate(expression);
    return { result, branch: result ? "true" : "false" };
  },
};

function evaluate(expression: string): boolean {
  if (expression === "") return false;

  const comparator = findComparator(expression);
  if (comparator) {
    const [rawLeft, rawRight] = splitOnce(expression, comparator);
    return compare(rawLeft.trim(), comparator, rawRight.trim());
  }

  return isTruthy(expression);
}

/** Finds the first top-level comparator, longest-token-first so `>=` wins over `>`. */
function findComparator(expression: string): Comparator | null {
  let best: { comparator: Comparator; index: number } | null = null;
  for (const comparator of COMPARATORS) {
    const index = expression.indexOf(comparator);
    if (index === -1) continue;
    if (!best || index < best.index || (index === best.index && comparator.length > 1)) {
      best = { comparator, index };
    }
  }
  return best?.comparator ?? null;
}

function splitOnce(expression: string, comparator: Comparator): [string, string] {
  const index = expression.indexOf(comparator);
  return [expression.slice(0, index), expression.slice(index + comparator.length)];
}

function compare(left: string, comparator: Comparator, right: string): boolean {
  const leftNum = Number(left);
  const rightNum = Number(right);
  const numeric = left !== "" && right !== "" && !Number.isNaN(leftNum) && !Number.isNaN(rightNum);

  if (numeric) {
    switch (comparator) {
      case "==":
        return leftNum === rightNum;
      case "!=":
        return leftNum !== rightNum;
      case ">":
        return leftNum > rightNum;
      case "<":
        return leftNum < rightNum;
      case ">=":
        return leftNum >= rightNum;
      case "<=":
        return leftNum <= rightNum;
    }
  }

  const l = unquote(left);
  const r = unquote(right);
  switch (comparator) {
    case "==":
      return l === r;
    case "!=":
      return l !== r;
    case ">":
      return l > r;
    case "<":
      return l < r;
    case ">=":
      return l >= r;
    case "<=":
      return l <= r;
  }
}

function isTruthy(value: string): boolean {
  const normalized = unquote(value).trim().toLowerCase();
  return normalized !== "" && normalized !== "false" && normalized !== "0" && normalized !== "null" && normalized !== "undefined";
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
