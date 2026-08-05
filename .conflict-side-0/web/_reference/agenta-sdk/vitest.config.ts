import {defineConfig} from "vitest/config"
import path from "path"

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
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
    resolve: {
        alias: {
            "@src": path.resolve(__dirname, "src"),
        },
    },
})
