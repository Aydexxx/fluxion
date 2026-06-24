import { Pool } from "pg";
import type { DbQueryRunner } from "../types";

/**
 * Production {@link DbQueryRunner} backed by node-postgres. Each query runs on a
 * short-lived single-connection pool created from the credential's connection
 * string. When `readOnly` is set (the default for the database node) the query
 * executes inside a `READ ONLY` transaction, so the database itself rejects any
 * write — a hard guarantee that doesn't rely on parsing the SQL.
 */
export const pgQueryRunner: DbQueryRunner = {
  async query(connectionString, sql, params, options) {
    const pool = new Pool({ connectionString, max: 1 });
    try {
      const client = await pool.connect();
      try {
        if (options.readOnly) {
          await client.query("BEGIN TRANSACTION READ ONLY");
          try {
            const result = await client.query(sql, params);
            await client.query("COMMIT");
            return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        }
        const result = await client.query(sql, params);
        return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  },
};
