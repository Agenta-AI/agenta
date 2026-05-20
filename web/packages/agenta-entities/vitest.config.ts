import path from "path"

import {defineConfig} from "vitest/config"

export default defineConfig({
    resolve: {
        alias: {
            // Stub @agenta/ui so Vitest doesn't transform the entire antd tree.
            // Entity tests only exercise Jotai atoms — no React rendering needed.
            "@agenta/ui": path.resolve(__dirname, "tests/__mocks__/agenta-ui.ts"),
        },
    },
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
            exclude: ["src/**/index.ts"],
            reporter: ["text", "lcov", "json-summary"],
            reportsDirectory: "./coverage",
        },
    },
})
