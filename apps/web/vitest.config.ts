import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    // Default stays "node" so pure-logic tests (history, api client) run
    // fast; component tests opt into jsdom individually via the
    // "// @vitest-environment jsdom" pragma at the top of the test file.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Dedicated SQLite file for tests — never the dev database. Schema is
    // kept in sync via the `pretest` npm script (prisma migrate deploy
    // against this same URL) before vitest ever runs.
    env: {
      DATABASE_URL: "file:./prisma/test.db",
    },
  },
});
