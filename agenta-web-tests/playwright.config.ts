import { defineConfig } from "@playwright/test";
import { allProjects } from "./playwright/config/projects";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI
    ? 2
    : process.env.RETRIES
    ? parseInt(process.env.RETRIES)
    : 0,
  workers: process.env.CI
    ? 1
    : process.env.MAX_WORKERS
    ? parseInt(process.env.MAX_WORKERS)
    : 2, // Allow 2 parallel environments by default
  reporter: "html",

  // Global test timeout
  timeout: 30000,

  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: allProjects,
});
