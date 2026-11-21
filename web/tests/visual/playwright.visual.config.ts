import {defineConfig} from "@playwright/test"

// Capture specs, not tests: they write PNG files to OUT and compare nothing.
// No webServer: the Storybook or the app is already running. Each spec sets the viewport of each recipe.
export default defineConfig({
    testDir: "./",
    testMatch: /.*\.spec\.ts/,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 120_000,
    reporter: "list",
    use: {
        launchOptions: {args: process.env.CI ? ["--no-sandbox"] : []},
    },
})
