import {defineConfig} from "vitest/config"

export default defineConfig({
    test: {
        include: ["tests/unit/**/*.test.ts"],
        environment: "node",
        // The web unit workflow collects `web/packages/*/test-results/junit.xml`.
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
