import dotenv from "dotenv";

dotenv.config();

function withDatabase(rawUrl: string, database: string): string {
  const url = new URL(rawUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

const baseUrl = process.env.DATABASE_URL ?? "postgresql://fluxion:fluxion@localhost:5432/fluxion?schema=public";

/** Dedicated Postgres database for the test run; isolated from the dev database on the same server. */
export const TEST_DATABASE_URL = withDatabase(baseUrl, "fluxion_test");

/** `template1` always exists on a Postgres server; only used to issue `CREATE DATABASE`. */
export const ADMIN_DATABASE_URL = withDatabase(baseUrl, "template1");

export function databaseNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}
