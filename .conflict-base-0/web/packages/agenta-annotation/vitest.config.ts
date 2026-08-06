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
