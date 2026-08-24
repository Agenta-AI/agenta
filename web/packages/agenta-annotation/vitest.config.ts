import path from "path"

import {defineConfig} from "vitest/config"

export default defineConfig({
    resolve: {
        alias: {
            // Stub @agenta/ui to avoid pulling in the full antd tree.
            // Annotation tests only exercise pure functions — no React rendering.
            "@agenta/ui": path.resolve(__dirname, "tests/__mocks__/agenta-ui.ts"),
        },
    },
    test: {
        // `{ts,tsx}`, not `*.test.ts`: a `.tsx` suite added here would otherwise be silently
        // SKIPPED (that hid six render tests in @agenta/ui). Collecting it means a package with
        // no JSX transform fails loudly instead — add `@vitejs/plugin-react-swc` and
        // `plugins: [react()]` (see agenta-ui / agenta-observability-ui) when that happens.
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
