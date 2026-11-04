"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ms = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const PORT = Number(process.env.AGENTA_BROWSER_PORT || 8790);
// The runner reads the token from this fixed path in the sandbox (services/runner/src/browser/live-link.ts).
const RUN_DIR = process.env.AGENTA_BROWSER_DIR || "/tmp/agenta-browser";

const config = {
  PORT,
  RUN_DIR,
  TOKEN_FILE: path.join(RUN_DIR, "token"),
  PID_FILE: path.join(RUN_DIR, "pid"),
  START_LOCK: path.join(RUN_DIR, "start.lock"),
  LOG_FILE: path.join(RUN_DIR, "browser.log"),
  VIEWPORT: { width: 1280, height: 800 },
  MAX_BODY_BYTES: 1024 * 1024,
  MAX_TEXT_CHARS: 30_000,
  ACTION_TIMEOUT_MS: 10_000,
  NAVIGATION_TIMEOUT_MS: 30_000,
  // One `wait` call returns inside Claude's default 120 s shell timeout.
  WAIT_SLICE_MS: ms("AGENTA_BROWSER_WAIT_SLICE_MS", 90_000),
  WAIT_TOTAL_MS: ms("AGENTA_BROWSER_WAIT_TOTAL_MS", 25 * 60_000),
  IDLE_EXIT_MS: ms("AGENTA_BROWSER_IDLE_MS", 15 * 60_000),
  // Control held this long with no input no longer blocks the agent: the person has moved on.
  USER_IDLE_MS: ms("AGENTA_BROWSER_USER_IDLE_MS", 20_000),
  // A frozen page never answers; the longest honest command (a slow `type`) stays well inside this.
  OP_TIMEOUT_MS: ms("AGENTA_BROWSER_OP_TIMEOUT_MS", 75_000),
  // A person can sign in and never click I'm done, and a sandbox can die with no shutdown.
  SAVE_EVERY_MS: ms("AGENTA_BROWSER_SAVE_EVERY_MS", 5_000),
  // A sign-in's cookies can land well after the last click, at the end of a redirect chain.
  SAVE_AFTER_INPUT_MS: ms("AGENTA_BROWSER_SAVE_AFTER_INPUT_MS", 60_000),
  START_TIMEOUT_MS: ms("AGENTA_BROWSER_START_TIMEOUT_MS", 60_000),
};

// Saved sign-ins, in the agent's shared `agent-files`, found from the cwd or any folder above it so
// a command run from a subfolder saves to the same place. The `.agenta-` segment keeps the file out
// of the drive the person browses.
function defaultStateFile(cwd = process.cwd()) {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "agent-files")))
      return path.join(dir, "agent-files", ".agenta-browser", "state.json");
    if (dir === path.dirname(dir)) break;
  }
  return path.resolve(cwd, ".agenta-browser", "state.json");
}

// The browser shares the host with nothing else only in a dedicated Daytona sandbox.
function isolationError(env = process.env) {
  if (env.DAYTONA_SANDBOX_ID || env.AGENTA_BROWSER_ALLOW_SHARED_HOST === "1")
    return null;
  return (
    "The browser is not available on this deployment: it runs only in a dedicated Daytona sandbox. " +
    "Tell the person you cannot use a browser here."
  );
}

module.exports = { ...config, defaultStateFile, isolationError };
