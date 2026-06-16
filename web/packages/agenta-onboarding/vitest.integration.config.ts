import path from "path"

import {defineConfig} from "vitest/config"

// Reuse the @agenta/entities integration harness (ephemeral-account global setup, worker auth,
// and the @agenta/ui antd stub) rather than duplicating it. The onboarding integration test
// needs a provisioned backend + a real testset, which that harness already provides.
const entitiesIntegration = path.resolve(__dirname, "../agenta-entities/tests/integration")
const entitiesUiMock = path.resolve(__dirname, "../agenta-entities/tests/__mocks__/agenta-ui.ts")

export default defineConfig({
    resolve: {
        alias: {
            "@agenta/ui": entitiesUiMock,
        },
    },
    test: {
        include: ["tests/integration/**/*.test.ts"],
        environment: "node",
        globalSetup: [path.resolve(entitiesIntegration, "setup/global.ts")],
        setupFiles: [path.resolve(entitiesIntegration, "setup/worker.ts")],
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
