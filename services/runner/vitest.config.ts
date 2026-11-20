import { defineConfig } from "vitest/config";

// Three test layers (unit / integration / acceptance), each scoped by directory.
// Reporters and outputFile are NOT allowed inside project entries (ProjectConfig type
// excludes them); they live on the CLI via --reporter and --outputFile flags set in
// package.json scripts. The project entries here only set name, include, and environment.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          // Many unit tests run real shell commands in the local sandbox stand-in. A loaded CI
          // runner can take longer than the 5 s default to start one, which is not a failure.
          testTimeout: 30_000,
          // Scrub ambient dev-env vars so unit tests never depend on the caller's shell.
          setupFiles: ["tests/setup/hermetic-env.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "acceptance",
          include: ["tests/acceptance/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
