import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Vitest 4's default exclude no longer covers `dist`, so a stray `tsc` build
    // (e.g. an IDE watch task) would otherwise get its compiled CommonJS test
    // files collected and fail with "Vitest cannot be imported in a CommonJS
    // module". We only ever run the TypeScript sources under `src`.
    exclude: [...configDefaults.exclude, "dist/**"],
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
