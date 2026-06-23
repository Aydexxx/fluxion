import type { ComponentType, SVGProps } from "react";
import {
  BoltIcon,
  BranchIcon,
  CalendarIcon,
  GlobeIcon,
  ReplyIcon,
  SparkIcon,
  TransformIcon,
  WebhookIcon,
} from "../components/icons";

export type NodeCategory = "trigger" | "action" | "ai" | "logic" | "output";

export interface CategoryMeta {
  id: NodeCategory;
  label: string;
  /** Single restrained hue per category — used for the icon chip + a thin accent line only. */
  accent: string;
}

export const CATEGORIES: Record<NodeCategory, CategoryMeta> = {
  trigger: { id: "trigger", label: "Triggers", accent: "#8b7bff" },
  action: { id: "action", label: "Actions", accent: "#4c9bff" },
  ai: { id: "ai", label: "Intelligence", accent: "#c26bff" },
  logic: { id: "logic", label: "Logic", accent: "#e0a33e" },
  output: { id: "output", label: "Output", accent: "#34d0a8" },
};

export const CATEGORY_ORDER: NodeCategory[] = ["trigger", "action", "ai", "logic", "output"];

export interface NodeSpec {
  type: string;
  category: NodeCategory;
  label: string;
  /** Short verb-phrase shown in the palette. */
  blurb: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Default human title for a freshly-dropped node. */
  defaultTitle: string;
  /** Default config seeded on drop. */
  defaultConfig: Record<string, unknown>;
  /** Handles: triggers have no input; outputs have no output. */
  hasInput: boolean;
  hasOutput: boolean;
}

export const NODE_SPECS: Record<string, NodeSpec> = {
  "trigger.manual": {
    type: "trigger.manual",
    category: "trigger",
    label: "Manual Trigger",
    blurb: "Start the run on demand",
    icon: BoltIcon,
    defaultTitle: "Manual trigger",
    defaultConfig: {},
    hasInput: false,
    hasOutput: true,
  },
  "trigger.webhook": {
    type: "trigger.webhook",
    category: "trigger",
    label: "Webhook",
    blurb: "Start on an inbound request",
    icon: WebhookIcon,
    defaultTitle: "Webhook",
    defaultConfig: {},
    hasInput: false,
    hasOutput: true,
  },
  "trigger.schedule": {
    type: "trigger.schedule",
    category: "trigger",
    label: "Schedule",
    blurb: "Run on a cron schedule",
    icon: CalendarIcon,
    defaultTitle: "Schedule",
    defaultConfig: { cron: "0 * * * *" },
    hasInput: false,
    hasOutput: true,
  },
  "action.http": {
    type: "action.http",
    category: "action",
    label: "HTTP Request",
    blurb: "Call an external API",
    icon: GlobeIcon,
    defaultTitle: "HTTP request",
    defaultConfig: { method: "GET", url: "", headers: "", body: "" },
    hasInput: true,
    hasOutput: true,
  },
  "action.transform": {
    type: "action.transform",
    category: "action",
    label: "Transform",
    blurb: "Reshape data with mappings",
    icon: TransformIcon,
    defaultTitle: "Transform",
    defaultConfig: { mappings: [{ key: "", value: "" }] },
    hasInput: true,
    hasOutput: true,
  },
  "ai.llm": {
    type: "ai.llm",
    category: "ai",
    label: "AI Model",
    blurb: "Prompt a language model",
    icon: SparkIcon,
    defaultTitle: "AI model",
    defaultConfig: { provider: "none", model: "llama3", prompt: "" },
    hasInput: true,
    hasOutput: true,
  },
  "logic.condition": {
    type: "logic.condition",
    category: "logic",
    label: "Condition",
    blurb: "Branch on an expression",
    icon: BranchIcon,
    defaultTitle: "Condition",
    defaultConfig: { expression: "" },
    hasInput: true,
    hasOutput: true,
  },
  "output.response": {
    type: "output.response",
    category: "output",
    label: "Response",
    blurb: "Return a final result",
    icon: ReplyIcon,
    defaultTitle: "Response",
    defaultConfig: { body: "" },
    hasInput: true,
    hasOutput: false,
  },
};

export const NODE_SPEC_LIST: NodeSpec[] = Object.values(NODE_SPECS);

/** Falls back to a neutral spec so an unknown persisted type still renders. */
export function getNodeSpec(type: string): NodeSpec {
  return (
    NODE_SPECS[type] ?? {
      type,
      category: "action",
      label: type,
      blurb: "Custom node",
      icon: GlobeIcon,
      defaultTitle: type,
      defaultConfig: {},
      hasInput: true,
      hasOutput: true,
    }
  );
}

export function categoryAccent(type: string): string {
  return CATEGORIES[getNodeSpec(type).category].accent;
}
