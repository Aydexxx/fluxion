import type { NodeExecutor } from "../types";
import { resolveCredential } from "./credentialUtil";
import { resolveTimeout, withTimeout } from "../timeout";

const DEFAULT_NOTION_TIMEOUT_MS = 30_000;
const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
/** The title-type property name on a generated Notion database, unless overridden. */
const DEFAULT_TITLE_PROPERTY = "Name";

type NotionAction = "create_page" | "append_text";

interface NotionConfig {
  credentialId?: string;
  action?: NotionAction;
  // create_page
  parentType?: "page" | "database";
  parentId?: string;
  title?: string;
  /** Database parents only: the name of the title-type property (default "Name"). */
  titleProperty?: string;
  /** Optional initial paragraph for the new page. */
  content?: string;
  // append_text
  pageId?: string;
  text?: string;
  /** Per-node timeout override (ms). */
  timeoutMs?: number;
}

export interface NotionOutput {
  action: NotionAction;
  /** The created page id, or the block id text was appended to. */
  id: string;
  /** The page's Notion URL, when the API returned one. */
  url: string | null;
}

interface NotionPageResponse {
  id?: string;
  url?: string;
}

function paragraphBlock(text: string): Record<string, unknown> {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: text } }] },
  };
}

/**
 * Creates a page (under a parent page or database) or appends a text block to
 * an existing page, via the Notion API. Auth is an internal integration secret
 * from a `notion_token` credential — the integration must also be explicitly
 * shared with the target page/database in Notion, which is the most common
 * cause of a 404 here.
 *
 * Scoped deliberately to plain-text content: a database parent's title
 * property is set from `title` (its name configurable via `titleProperty`,
 * since Notion lets a database rename it), and an optional `content` paragraph
 * seeds the new page. Notion's per-property-type schema (select, date, relation,
 * …) is out of scope — `action.http` is the escape hatch for richer property sets.
 */
export const notionExecutor: NodeExecutor = {
  type: "action.notion",
  async execute(node, _input, context): Promise<NotionOutput> {
    const config = node.config as NotionConfig;
    const action = config.action ?? "create_page";

    const { data: cred } = await resolveCredential(context, config.credentialId, "notion_token");
    if (!cred.token) throw new Error("notion_token credential is missing its token");

    const headers: Record<string, string> = {
      Authorization: `Bearer ${cred.token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    };

    let method: string;
    let path: string;
    let body: Record<string, unknown>;

    if (action === "create_page") {
      const parentId = (config.parentId ?? "").trim();
      if (!parentId) throw new Error("notion create_page requires a 'parentId' (page or database id)");
      const title = (config.title ?? "").trim();
      if (!title) throw new Error("notion create_page requires a 'title'");

      const parentType = config.parentType ?? "page";
      const titleProperty = parentType === "database" ? config.titleProperty?.trim() || DEFAULT_TITLE_PROPERTY : "title";
      const content = config.content?.trim();

      method = "POST";
      path = "/pages";
      body = {
        parent: parentType === "database" ? { database_id: parentId } : { page_id: parentId },
        properties: { [titleProperty]: { title: [{ text: { content: title } }] } },
        children: content ? [paragraphBlock(content)] : [],
      };
    } else if (action === "append_text") {
      const pageId = (config.pageId ?? "").trim();
      if (!pageId) throw new Error("notion append_text requires a 'pageId'");
      const text = (config.text ?? "").trim();
      if (!text) throw new Error("notion append_text requires 'text'");

      method = "PATCH";
      path = `/blocks/${pageId}/children`;
      body = { children: [paragraphBlock(text)] };
    } else {
      const unreachable: never = action;
      throw new Error(`Unsupported notion action: ${String(unreachable)}`);
    }

    const timeoutMs = resolveTimeout(config.timeoutMs, context.limits?.httpTimeoutMs ?? DEFAULT_NOTION_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await withTimeout(
        context.fetch(`${NOTION_API_BASE}${path}`, { method, headers, body: JSON.stringify(body), signal: controller.signal }),
        timeoutMs,
        `Notion node (${action})`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const parsed = text ? safeJsonParse(text) : null;
    if (!res.ok) {
      const message = (parsed as { message?: string } | null)?.message ?? (text.slice(0, 300) || `status ${res.status}`);
      throw new Error(`Notion API error (${res.status}): ${message}`);
    }

    if (action === "create_page") {
      const page = (parsed ?? {}) as NotionPageResponse;
      return { action, id: page.id ?? "", url: page.url ?? null };
    }
    return { action, id: config.pageId!.trim(), url: null };
  },
};

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
