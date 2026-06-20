import { defineConfig } from "vitest/config";

// Mirrors the web/packages/* convention: node env, junit for CI publishing, v8 coverage
// over src/. Unit tests live in tests/unit/**; the runner code stays in src/.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    reporters: ["default", "junit"],
    outputFile: {
      junit: "./test-results/junit.xml",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
    },
  },
});
