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
