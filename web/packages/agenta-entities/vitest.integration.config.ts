import path from "path"

import {defineConfig} from "vitest/config"

export default defineConfig({
    resolve: {
        alias: {
            "@agenta/ui": path.resolve(__dirname, "tests/__mocks__/agenta-ui.ts"),
        },
    },
    test: {
        include: ["tests/integration/**/*.test.ts"],
        environment: "node",
        globalSetup: ["tests/integration/setup/global.ts"],
        setupFiles: ["tests/integration/setup/worker.ts"],
        testTimeout: 30_000,
        hookTimeout: 30_000,
        sequence: {
            concurrent: false,
        },
        reporters: ["default", "junit"],
        outputFile: {
            junit: "./test-results/integration-junit.xml",
        },
    },
})
