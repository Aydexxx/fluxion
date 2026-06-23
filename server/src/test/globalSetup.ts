import { execSync } from "node:child_process";
import { ADMIN_DATABASE_URL, TEST_DATABASE_URL, databaseNameOf } from "./constants";

/**
 * Runs once before the whole test run, in the main process (not a worker).
 * Postgres needs the target database to exist before `db push` can run
 * against it, so this first creates it (ignoring "already exists") against
 * the always-present `template1` database, then pushes the current schema.
 */
export default function setup(): void {
  try {
    execSync("npx prisma db execute --stdin", {
      input: `CREATE DATABASE "${databaseNameOf(TEST_DATABASE_URL)}";`,
      env: { ...process.env, DATABASE_URL: ADMIN_DATABASE_URL },
    });
  } catch {
    // Database already exists from a previous run; safe to ignore.
  }

  execSync("npx prisma db push --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });
}
