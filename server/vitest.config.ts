import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["src/test/globalSetup.ts"],
    setupFiles: ["src/test/setupEnv.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: "forks",
    // All test files share one Postgres database (see globalSetup.ts), and
    // WorkspaceMember/Workspace reference User with an ON DELETE RESTRICT-like
    // foreign key, so a `beforeEach` in one file can race with another file's
    // fixtures. Running files sequentially avoids that.
    fileParallelism: false,
  },
});
