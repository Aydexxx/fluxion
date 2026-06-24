import type { NodeExecutor } from "../types";
import { resolveTimeout, withTimeout } from "../timeout";

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

interface HttpConfig {
  method?: string;
  url?: string;
  /** Either a record, or the editor's multiline "Key: Value" string. */
  headers?: Record<string, string> | string;
  body?: unknown;
  /** Per-node timeout override (ms). */
  timeoutMs?: number;
}

export interface HttpOutput {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
}

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

/**
 * Makes an outbound HTTP request. Method/url/headers/body come from the node
 * config (already template-resolved upstream, so `{{n1.url}}` etc. are concrete
 * by now). The response is returned as `{ status, statusText, headers, body }`,
 * with `body` parsed as JSON when the response is JSON, else returned as text —
 * a non-2xx status is *not* an error here, so a downstream condition can branch
 * on it. Network-level failures reject and fail the run (fail-fast).
 */
export const httpExecutor: NodeExecutor = {
  type: "action.http",
  async execute(node, _input, context): Promise<HttpOutput> {
    const config = node.config as HttpConfig;
    const url = config.url;
    if (!url || typeof url !== "string") {
      throw new Error("http node requires a 'url' in its config");
    }
    const method = (config.method ?? "GET").toUpperCase();

    const headers = normalizeHeaders(config.headers);
    let body: string | undefined;
    if (!METHODS_WITHOUT_BODY.has(method) && config.body != null) {
      if (typeof config.body === "string") {
        body = config.body;
      } else {
        body = JSON.stringify(config.body);
        if (!hasHeader(headers, "content-type")) headers["Content-Type"] = "application/json";
      }
    }

    // Bound how long a node can wait, and actually abort the request when the
    // runtime supports it, so a hung endpoint can't pin a worker forever.
    const timeoutMs = resolveTimeout(config.timeoutMs, context.limits?.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await withTimeout(
        context.fetch(url, { method, headers, body, signal: controller.signal }),
        timeoutMs,
        `HTTP node (${method} ${url})`,
      );
    } finally {
      clearTimeout(timer);
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      body: await parseBody(res),
    };
  },
};

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

/** Accepts a record or a "Key: Value" line-per-header string and returns a string record. */
function normalizeHeaders(raw: HttpConfig["headers"]): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === "string") {
    const headers: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) headers[key] = value;
    }
    return headers;
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) headers[key] = String(value);
  return headers;
}

async function parseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!text) return null;
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
