import {defineConfig} from "vitest/config"

export default defineConfig({
    test: {
        // `{ts,tsx}`, not `*.test.ts`: a `.tsx` suite added here would otherwise be silently
        // SKIPPED. This package's testable surface is pure functions over refs and groups, so
        // `node` is enough — no JSX transform is configured.
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        environment: "node",
        reporters: ["default", "junit"],
        outputFile: {
            junit: "./test-results/junit.xml",
        },
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/**/index.ts"],
            reporter: ["text", "lcov", "json-summary"],
            reportsDirectory: "./coverage",
        },
    },
})
