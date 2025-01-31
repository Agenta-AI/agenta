/**
 * Playwright Test Runner Script
 * Executes test suites based on provided command line arguments.
 */

import { execSync } from "child_process";

const command = `playwright test ${process.argv.slice(2).join(" ")}`;
execSync(command, { stdio: "inherit" });
