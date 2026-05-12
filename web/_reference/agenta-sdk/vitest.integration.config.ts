import {defineConfig} from "vitest/config"
import path from "path"
import {readFileSync} from "fs"

// Load .env.test into process.env before tests run
try {
    const envFile = readFileSync(path.resolve(__dirname, ".env.test"), "utf-8")
    for (const line of envFile.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eqIdx = trimmed.indexOf("=")
        if (eqIdx === -1) continue
        const key = trimmed.slice(0, eqIdx).trim()
        const value = trimmed.slice(eqIdx + 1).trim()
        if (!process.env[key]) {
            process.env[key] = value
        }
    }
} catch {
    // No .env.test — integration tests will skip
}

export default defineConfig({
    test: {
        include: ["tests/integration/**/*.test.ts"],
        environment: "node",
        testTimeout: 30_000,
        reporters: ["default", "junit"],
        outputFile: {
            junit: "./test-results/integration-junit.xml",
        },
    },
    resolve: {
        alias: {
            "@src": path.resolve(__dirname, "src"),
        },
    },
})
