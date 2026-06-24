import type { NodeExecutor } from "../types";
import { resolveCredential } from "./credentialUtil";

interface DatabaseConfig {
  credentialId?: string;
  query?: string;
  /** Positional parameters for the parameterized query ($1, $2, …). */
  params?: unknown[];
  /** Read-only by default; must be explicitly set false to allow writes. */
  readOnly?: boolean;
}

/** Statements allowed when the node is read-only (the common, safe default). */
const READ_ONLY_PREFIXES = ["SELECT", "WITH"];

/**
 * Runs a parameterized SQL query against a database configured via a `database`
 * credential. Parameters are always bound positionally (`$1`, `$2`, …) — values
 * are never concatenated into the SQL — so resolved template values can't change
 * the query's structure. Read-only by default: the statement is checked to be a
 * SELECT/WITH up front, and the runner additionally executes it inside a
 * `READ ONLY` transaction, so the database rejects writes even if the check is
 * fooled.
 */
export const databaseExecutor: NodeExecutor = {
  type: "action.database",
  async execute(node, _input, context) {
    const config = node.config as DatabaseConfig;
    if (!context.db) throw new Error("Database client is not configured for this run");

    const query = (config.query ?? "").trim();
    if (!query) throw new Error("database node requires a 'query'");

    const readOnly = config.readOnly !== false;
    if (readOnly && !READ_ONLY_PREFIXES.some((p) => query.toUpperCase().startsWith(p))) {
      throw new Error("Read-only database node only allows SELECT/WITH queries");
    }

    const params = Array.isArray(config.params) ? config.params : [];

    const { data } = await resolveCredential(context, config.credentialId, "database");
    if (!data.connectionString) throw new Error("database credential is missing its connectionString");

    return context.db.query(data.connectionString, query, params, { readOnly });
  },
};
