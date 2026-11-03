"use strict";

// The command the agent runs: parse it, start the browser server when none answers, send the
// command, print the result.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const config = require("./config.cjs");
const { pidAlive, readPid, withLock } = require("./lock.cjs");

const USAGE = `agenta-browser: drive one Chromium that keeps running between commands.

  open <url>                     open a page (also: open back, open forward)
  read [ref] [--interactive]     read the page, or one part of it by ref
  find <text>                    find text on the page, with its list item or row
  click <ref>                    click (or: click --role button --name "Save")
  type <ref> <text> [--submit]   replace a field's text; --submit presses Enter
  set <ref> <value>              choose an option, tick a box, or fill a field
  tab [number]                   list the open tabs, or switch to one
  wait "<reason>"                hand the browser to the person; run it again while it says Still waiting
  save                           save the sign-ins now (also saved after each command)
  stop                           close the browser

Pay and delete controls are refused until you add --intent pay or --intent delete.
Only add it after the person said yes. Put -- before text that starts with --.`;

const BOOLEAN_FLAGS = new Set(["submit", "interactive"]);
const VALUE_FLAGS = new Set(["role", "name", "intent"]);

// Only known flags are flags; anything else, and everything after `--`, is text.
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    const flag = a.startsWith("--") ? a.slice(2) : "";
    if (BOOLEAN_FLAGS.has(flag)) flags[flag] = true;
    else if (VALUE_FLAGS.has(flag) && i + 1 < argv.length) flags[flag] = argv[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

// The server path and body for one command line, or null for an unknown command.
function request(command, { positional: p, flags: f }) {
  const target = { ref: f.role ? undefined : p[0], role: f.role, name: f.name };
  const rest = (f.role ? p : p.slice(1)).join(" ");
  switch (command) {
    case "open":
      return ["/op", { op: "navigate", args: { url: p.join(" ") } }];
    case "read":
      return ["/op", { op: "read_page", args: { ref: p[0], filter: f.interactive ? "interactive" : undefined } }];
    case "find":
      return ["/op", { op: "find", args: { query: p.join(" ") } }];
    case "click":
      return ["/op", { op: "click", args: { ...target, intent: f.intent } }];
    case "type":
      return ["/op", { op: "type", args: { ...target, text: rest, submit: f.submit, intent: f.intent } }];
    case "set":
      return ["/op", { op: "form_input", args: { ...target, value: rest, intent: f.intent } }];
    case "tab":
      return ["/op", { op: "tab", args: { index: p[0] } }];
    case "wait":
      return ["/wait", { reason: p.join(" ") }];
    case "save":
      return ["/save", {}];
    case "stop":
      return ["/stop", {}];
    default:
      return null;
  }
}

// node:http, not fetch: undici's header timeout is not ours to set per call.
function call(pathname, body, timeoutMs) {
  let token = "";
  try {
    token = fs.readFileSync(config.TOKEN_FILE, "utf8");
  } catch {}
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: config.PORT,
        path: pathname,
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json", "x-agenta-browser-token": token },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (e) {
            reject(e);
          }
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("The browser did not answer in time.")));
    req.on("error", reject);
    req.end(payload);
  });
}

const healthy = () => call("/health", null, 3_000).then((r) => r.ok === true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Playwright is installed globally in the sandbox image; its playwright-core sits inside it.
function nodePath() {
  const root = path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules");
  return [process.env.NODE_PATH, root, path.join(root, "playwright", "node_modules")]
    .filter(Boolean)
    .join(path.delimiter);
}

async function untilHealthy(deadline, serverPid) {
  while (Date.now() < deadline) {
    if (await healthy()) return true;
    if (serverPid && !pidAlive(serverPid)) return false;
    await sleep(250);
  }
  return false;
}

async function untilGone(deadline) {
  while (await healthy()) {
    if (Date.now() > deadline) {
      const pid = readPid(config.PID_FILE);
      if (pidAlive(pid)) process.kill(pid, "SIGKILL");
      return;
    }
    await sleep(200);
  }
}

// One starter at a time; the others wait on the lock and then find the browser answering.
async function ensureRunning(entry) {
  if (await healthy()) return;
  fs.mkdirSync(config.RUN_DIR, { recursive: true, mode: 0o700 });
  await withLock(config.START_LOCK, 2 * config.START_TIMEOUT_MS + 5_000, async () => {
    if (await healthy()) return;
    // A server that is alive but not healthy is still launching Chromium, or is stuck.
    const existing = readPid(config.PID_FILE);
    if (pidAlive(existing)) {
      if (await untilHealthy(Date.now() + config.START_TIMEOUT_MS, existing)) return;
      if (pidAlive(existing)) {
        process.kill(existing, "SIGKILL");
        await sleep(500);
      }
    }
    const log = fs.openSync(config.LOG_FILE, "a");
    // Detached: its own session and process group, so a command time limit never kills the browser.
    const child = spawn(process.execPath, [entry, "serve"], {
      detached: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        NODE_PATH: nodePath(),
        AGENTA_BROWSER_STATE: process.env.AGENTA_BROWSER_STATE || config.defaultStateFile(),
      },
    });
    child.unref();
    if (await untilHealthy(Date.now() + config.START_TIMEOUT_MS, child.pid)) return;
    throw new Error(`The browser did not start. See ${config.LOG_FILE}.`);
  });
}

async function main(argv, entry) {
  const [command, ...rest] = argv;
  if (command === "serve") return require("./server.cjs").serve();
  const req = command && request(command, parseArgs(rest));
  if (!req) {
    console.log(USAGE);
    process.exit(command ? 2 : 0);
  }
  const refusal = config.isolationError();
  if (refusal) {
    console.log(`Error (browser_unavailable): ${refusal}`);
    process.exit(1);
  }
  if (command === "stop" && !(await healthy())) return console.log("The browser is not running.");
  await ensureRunning(entry);
  const timeout = command === "wait" ? config.WAIT_SLICE_MS + 15_000 : 120_000;
  const result = await call(req[0], req[1], timeout);
  // Return only when the browser is gone, so the next command starts a fresh one.
  if (command === "stop") await untilGone(Date.now() + 15_000);
  if (result.ok) return console.log(result.text);
  const { code, message, next_step } = result.error || {};
  console.log(`Error (${code}): ${message}${next_step ? `\nNext: ${next_step}` : ""}`);
  process.exit(1);
}

module.exports = { main, parseArgs, request };
