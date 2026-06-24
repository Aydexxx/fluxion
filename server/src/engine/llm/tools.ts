/**
 * The small, deliberately safe tool set the `ai.agent` node can call.
 *
 *  - `rag_search` — keyword search over a knowledge list supplied on the node
 *    (the RAGBot idea, in miniature). No network, fully deterministic.
 *  - `http_get` — a read-only HTTP GET. No other methods, no request body, and
 *    only http(s) URLs, so an agent can fetch context but can't be coaxed into
 *    mutating anything.
 *
 * A tool takes a plain args object and returns an observation string that gets
 * fed back into the agent loop.
 */

export interface AgentTool {
  name: string;
  description: string;
  run(args: Record<string, unknown>): Promise<string>;
}

export interface KnowledgeDoc {
  id: string;
  text: string;
}

/** Normalizes the node's `knowledge` config (strings or `{id,text}` objects) into docs. */
export function normalizeKnowledge(raw: unknown): KnowledgeDoc[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry, i) => {
    if (typeof entry === "string") return entry.trim() ? [{ id: `doc${i + 1}`, text: entry }] : [];
    if (entry && typeof entry === "object") {
      const text = (entry as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) {
        const id = (entry as { id?: unknown }).id;
        return [{ id: typeof id === "string" && id ? id : `doc${i + 1}`, text }];
      }
    }
    return [];
  });
}

/** Tokenizes to lowercased words of length > 2, for overlap scoring. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length > 2) ?? [];
}

/**
 * Deterministic keyword RAG search: scores each doc by how many distinct query
 * tokens it contains and returns the top matches, so the same query + knowledge
 * always yields the same observation.
 */
export function ragSearchTool(knowledge: KnowledgeDoc[]): AgentTool {
  return {
    name: "rag_search",
    description: "Search the provided knowledge base for text relevant to a query. Args: { query }.",
    async run(args) {
      const query = typeof args.query === "string" ? args.query : "";
      const queryTokens = new Set(tokenize(query));
      if (queryTokens.size === 0 || knowledge.length === 0) return "no relevant documents found";

      const scored = knowledge
        .map((doc) => {
          const docTokens = new Set(tokenize(doc.text));
          let score = 0;
          for (const t of queryTokens) if (docTokens.has(t)) score += 1;
          return { doc, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
        .slice(0, 2);

      if (scored.length === 0) return "no relevant documents found";
      return scored.map((s) => `[${s.doc.id}] ${s.doc.text}`).join(" | ");
    },
  };
}

/** Read-only HTTP GET tool. Restricted to http(s) and never sends a body. */
export function httpGetTool(fetchImpl: typeof fetch): AgentTool {
  return {
    name: "http_get",
    description: "Fetch the body of an http(s) URL with a GET request. Args: { url }.",
    async run(args) {
      const url = typeof args.url === "string" ? args.url : "";
      if (!/^https?:\/\//i.test(url)) return "error: url must start with http:// or https://";
      try {
        const res = await fetchImpl(url, { method: "GET" });
        const body = (await res.text()).slice(0, 500);
        return `status ${res.status}: ${body}`;
      } catch (error) {
        return `error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}
