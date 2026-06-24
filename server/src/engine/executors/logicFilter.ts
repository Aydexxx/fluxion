import type { NodeExecutor } from "../types";
import { lookupPath, readArrayInput } from "./collections";

type Operator = "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "not_contains" | "truthy" | "falsy";

interface FilterConfig {
  items?: unknown;
  /** Dotted path read from each item; empty = the item itself. */
  field?: string;
  operator?: Operator;
  value?: string;
}

export interface FilterOutput {
  items: unknown[];
  count: number;
  removed: number;
}

/**
 * Drops items from an array input that don't satisfy a condition. The condition
 * reads `field` (a dotted path) from each item and compares it to `value` with
 * `operator`. Comparison is numeric when both sides look numeric, else string;
 * `truthy`/`falsy` test the value alone, and `contains`/`not_contains` do
 * substring matching. Field references are plain (not `{{templates}}`) so they
 * are evaluated here, per item, after the orchestrator's config resolution.
 */
export const filterExecutor: NodeExecutor = {
  type: "logic.filter",
  async execute(node, input): Promise<FilterOutput> {
    const config = node.config as FilterConfig;
    const source = readArrayInput(config.items, input);
    const operator = (config.operator ?? "truthy") as Operator;
    const field = config.field ?? "";
    const value = config.value ?? "";

    const items = source.filter((item) => matches(lookupPath(item, field), operator, value));
    return { items, count: items.length, removed: source.length - items.length };
  },
};

function matches(actual: unknown, operator: Operator, value: string): boolean {
  if (operator === "truthy") return isTruthy(actual);
  if (operator === "falsy") return !isTruthy(actual);

  const actualStr = actual == null ? "" : typeof actual === "object" ? JSON.stringify(actual) : String(actual);
  if (operator === "contains") return actualStr.includes(value);
  if (operator === "not_contains") return !actualStr.includes(value);

  const actualNum = Number(actualStr);
  const valueNum = Number(value);
  const numeric = actualStr !== "" && value !== "" && !Number.isNaN(actualNum) && !Number.isNaN(valueNum);

  switch (operator) {
    case "==":
      return numeric ? actualNum === valueNum : actualStr === value;
    case "!=":
      return numeric ? actualNum !== valueNum : actualStr !== value;
    case ">":
      return numeric ? actualNum > valueNum : actualStr > value;
    case "<":
      return numeric ? actualNum < valueNum : actualStr < value;
    case ">=":
      return numeric ? actualNum >= valueNum : actualStr >= value;
    case "<=":
      return numeric ? actualNum <= valueNum : actualStr <= value;
    default:
      return false;
  }
}

function isTruthy(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  const s = String(value).trim().toLowerCase();
  return s !== "" && s !== "false" && s !== "0" && s !== "null" && s !== "undefined";
}
