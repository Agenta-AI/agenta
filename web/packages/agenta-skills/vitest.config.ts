import {defineConfig} from "vitest/config"

export default defineConfig({
    test: {
        // `{ts,tsx}`, not `*.test.ts`: a `.tsx` suite added here would otherwise be silently
        // SKIPPED. Collecting it means a package with no JSX transform fails loudly instead —
        // add `@vitejs/plugin-react-swc` and `plugins: [react()]` when that happens.
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        environment: "node",
        reporters: ["default", "junit"],
        outputFile: {junit: "./test-results/junit.xml"},
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/**/index.ts"],
            reporter: ["text", "lcov", "json-summary"],
            reportsDirectory: "./coverage",
        },
    },
})
