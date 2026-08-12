import {defineConfig} from "vitest/config"

export default defineConfig({
    test: {
        include: ["tests/unit/**/*.test.ts"],
        environment: "jsdom",
        reporters: ["default", "junit"],
        outputFile: {junit: "./test-results/junit.xml"},
    },
})
