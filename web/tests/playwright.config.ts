import {createRequire} from "module"
import {dirname, resolve} from "path"
import {fileURLToPath} from "url"

import {defineConfig} from "@playwright/test"
import dotenv from "dotenv"

import {
    getChromiumLaunchOptions,
    getJunitPath,
    getOutputDir,
    getReportDir,
    getStorageStatePath,
    getTestDir,
} from "./playwright/config/runtime.ts"

// Get current directory in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables from .env file
dotenv.config({path: resolve(__dirname, ".env")})

// Do not hard-fail here on auth provider env vars.
// global-setup determines which auth flow is active and validates
// only the variables required for that flow.

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const require = createRequire(import.meta.url)
export default defineConfig({
    testDir: getTestDir(),
    // Tests within each spec file run serially — they share browser state and often
    // depend on earlier steps. Across files, tests could run in parallel, but the
    // test suite shares project-scoped store singletons (registryPaginatedStore,
    // evaluatorsPaginatedStore) that get invalidated when any worker writes data.
    // Until tests are isolated per-worker (each with its own ephemeral project),
    // CI must stay at workers:1 to keep those polls stable. PLAYWRIGHT_WORKERS
    // overrides this for targeted local runs where the developer controls scope.
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : process.env.RETRIES ? parseInt(process.env.RETRIES) : 0,
    workers: process.env.PLAYWRIGHT_WORKERS ? parseInt(process.env.PLAYWRIGHT_WORKERS) : 1,
    reporter: [
        ["html", {outputFolder: getReportDir()}],
        ["junit", {outputFile: getJunitPath()}],
        [require.resolve("./playwright/live-reporter.ts")],
    ],
    outputDir: getOutputDir(),
    globalSetup: require.resolve("./playwright/global-setup"),
    globalTeardown: require.resolve("./playwright/global-teardown"),
    // Global test timeout
    timeout: 60000,
    expect: {
        /**
         * Maximum time expect() should wait for the condition to be met.
         * For example in `await expect(locator).toHaveText();`
         */
        timeout: 1 * 60 * 1000,
    },

    use: {
        baseURL: process.env.AGENTA_WEB_URL || "http://localhost:3000",
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        storageState: getStorageStatePath(),
        launchOptions: getChromiumLaunchOptions(),
    },
})
