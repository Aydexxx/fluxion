import type { NodeExecutor } from "../types";
import { resolveCredential } from "./credentialUtil";
import { resolveTimeout, withTimeout } from "../timeout";

const DEFAULT_GITHUB_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

type GithubAction = "create_issue" | "add_comment" | "dispatch_workflow";

interface KeyValueRow {
  key?: unknown;
  value?: unknown;
}

interface GithubConfig {
  credentialId?: string;
  action?: GithubAction;
  /** "owner/repo". */
  repo?: string;
  // create_issue
  title?: string;
  body?: string;
  /** Comma-separated string, or an array of label names. */
  labels?: string | string[];
  // add_comment
  issueNumber?: number | string;
  // dispatch_workflow
  /** Workflow filename (e.g. "deploy.yml") or numeric workflow id. */
  workflowFile?: string;
  ref?: string;
  /** Editor rows (`[{ key, value }]`) or a plain record, passed through as `inputs`. */
  inputs?: KeyValueRow[] | Record<string, unknown>;
  /** Per-node timeout override (ms). */
  timeoutMs?: number;
}

export interface GithubOutput {
  action: GithubAction;
  status: number;
  /** The parsed JSON response; null for the 204-No-Content dispatch endpoint. */
  data: unknown;
}

function parseRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`github node 'repo' must be "owner/repo", got "${repo}"`);
  return { owner, name };
}

function normalizeLabels(labels: GithubConfig["labels"]): string[] | undefined {
  if (Array.isArray(labels)) return labels.map(String).filter((l) => l.trim() !== "");
  if (typeof labels === "string" && labels.trim() !== "") {
    return labels.split(",").map((l) => l.trim()).filter(Boolean);
  }
  return undefined;
}

/** Mirrors `action.transform`'s mapping-row convention: editor rows in, a plain object out. */
function normalizeInputs(inputs: GithubConfig["inputs"]): Record<string, unknown> | undefined {
  if (Array.isArray(inputs)) {
    const out: Record<string, unknown> = {};
    for (const row of inputs) {
      if (typeof row?.key === "string" && row.key.trim() !== "") out[row.key] = row.value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  if (inputs && typeof inputs === "object") return inputs as Record<string, unknown>;
  return undefined;
}

/**
 * Calls the GitHub REST API for the three highest-value workflow actions: open
 * an issue, comment on one, or dispatch a `workflow_dispatch`-enabled Actions
 * workflow. Auth is a personal access token from a `github_token` credential;
 * `baseUrl` on that credential lets this also target GitHub Enterprise.
 */
export const githubExecutor: NodeExecutor = {
  type: "action.github",
  async execute(node, _input, context): Promise<GithubOutput> {
    const config = node.config as GithubConfig;
    const action = config.action ?? "create_issue";

    const repo = (config.repo ?? "").trim();
    if (!repo) throw new Error("github node requires a 'repo' (owner/repo)");
    const { owner, name } = parseRepo(repo);

    const { data: cred } = await resolveCredential(context, config.credentialId, "github_token");
    if (!cred.token) throw new Error("github_token credential is missing its token");
    const baseUrl = (cred.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");

    const headers: Record<string, string> = {
      Authorization: `Bearer ${cred.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "Fluxion-Workflow-Engine",
      "Content-Type": "application/json",
    };

    let path: string;
    let body: Record<string, unknown>;

    if (action === "create_issue") {
      const title = (config.title ?? "").trim();
      if (!title) throw new Error("github create_issue requires a 'title'");
      path = `/repos/${owner}/${name}/issues`;
      body = { title, body: config.body ?? "", labels: normalizeLabels(config.labels) };
    } else if (action === "add_comment") {
      if (config.issueNumber === undefined || config.issueNumber === "") {
        throw new Error("github add_comment requires an 'issueNumber'");
      }
      const commentBody = (config.body ?? "").trim();
      if (!commentBody) throw new Error("github add_comment requires a 'body'");
      path = `/repos/${owner}/${name}/issues/${config.issueNumber}/comments`;
      body = { body: commentBody };
    } else if (action === "dispatch_workflow") {
      const workflowFile = (config.workflowFile ?? "").trim();
      if (!workflowFile) throw new Error("github dispatch_workflow requires a 'workflowFile' (e.g. deploy.yml)");
      path = `/repos/${owner}/${name}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`;
      body = { ref: (config.ref ?? "main").trim() || "main", inputs: normalizeInputs(config.inputs) };
    } else {
      const unreachable: never = action;
      throw new Error(`Unsupported github action: ${String(unreachable)}`);
    }

    const timeoutMs = resolveTimeout(config.timeoutMs, context.limits?.httpTimeoutMs ?? DEFAULT_GITHUB_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await withTimeout(
        context.fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
        timeoutMs,
        `GitHub node (${action})`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const parsed = text ? safeJsonParse(text) : null;
    if (!res.ok) {
      const message = (parsed as { message?: string } | null)?.message ?? (text.slice(0, 300) || `status ${res.status}`);
      throw new Error(`GitHub API error (${res.status}): ${message}`);
    }

    return { action, status: res.status, data: parsed };
  },
};

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
