import {createRequire} from "module"
import {dirname, resolve} from "path"
import {fileURLToPath} from "url"

import {defineConfig} from "@playwright/test"
import dotenv from "dotenv"


// Get current directory in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables from .env file
dotenv.config({path: resolve(__dirname, ".env")})

// Verify required environment variables
const requiredEnvVars = ["TESTMAIL_API_KEY", "TESTMAIL_NAMESPACE"]
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName])

if (missingEnvVars.length > 0) {
    console.error("Missing required environment variables:", missingEnvVars)
    process.exit(1)
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const require = createRequire(import.meta.url)
export default defineConfig({
    testDir: `../${process.env.AGENTA_LICENSE || "oss"}/tests/playwright/e2e`,
    fullyParallel: false, // Temporarily disabled parallel worker
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : process.env.RETRIES ? parseInt(process.env.RETRIES) : 0,
    workers: 1, // Temporarily disabled parallel worker
    reporter: "html",
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
        baseURL: process.env.AGENTA_WEB_URL || "http://localhost",
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        storageState: "state.json",
    },
})
