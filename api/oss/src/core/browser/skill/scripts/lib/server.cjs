"use strict";

// `agenta-browser serve`: the long-lived process. It owns Chromium. `/health` and the `/live` view
// answer on all interfaces (the sandbox's preview link reaches them there); the CLI's control
// routes answer only from inside the sandbox.

const http = require("node:http");
const fs = require("node:fs");
const crypto = require("node:crypto");
const config = require("./config.cjs");
const { createSession, titleOf, within } = require("./browser.cjs");
const { createLiveView, webSocketServer } = require("./live-view.cjs");
const { OPS, agentError, errorText, opError } = require("./ops.cjs");
const { pageView } = require("./page-text.cjs");
const { createWaits } = require("./waits.cjs");

const log = (message) => console.log(`${new Date().toISOString()} ${message}`);

function writePrivate(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > config.MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const tabLine = (page, i, active) =>
  titleOf(page).then((title) => `${page === active ? "*" : " "} ${i + 1}. ${title || "(no title)"} (${page.url()})`);

async function newTabsNote(opened, all) {
  if (!opened.length) return "";
  const lines = await Promise.all(opened.map((p) => tabLine(p, all.indexOf(p), null)));
  return (
    `\n[${opened.length === 1 ? "A new tab opened" : `${opened.length} new tabs opened`}; you are still on the same tab. ` +
    "Run `agenta-browser tab <number>` to switch.]\n" +
    lines.join("\n")
  );
}

async function serve() {
  const refusal = config.isolationError();
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  fs.mkdirSync(config.RUN_DIR, { recursive: true, mode: 0o700 });
  const stateFile = process.env.AGENTA_BROWSER_STATE || config.defaultStateFile();

  let session;
  const waits = createWaits({
    sliceMs: config.WAIT_SLICE_MS,
    totalMs: config.WAIT_TOTAL_MS,
    graceMs: config.WAIT_GRACE_MS,
    onChange: () => session.emit("status"),
  });
  session = createSession({ stateFile, waits });
  const live = createLiveView(session);
  const accessToken = crypto.randomBytes(32).toString("hex");
  let busy = 0;

  function authorized(req) {
    const given = Buffer.from(String(req.headers["x-agenta-browser-token"] || ""));
    const expected = Buffer.from(accessToken);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  // Past the limit the next command runs. `op.stopped` tells this one to touch nothing more.
  function withinOpTime(work) {
    const op = { stopped: false };
    let timer;
    const stuck = new Promise((_, reject) => {
      timer = setTimeout(() => {
        op.stopped = true;
        reject(Object.assign(new Error("page stuck"), { code: "page_stuck" }));
      }, config.OP_TIMEOUT_MS);
    });
    return Promise.race([work(op), stuck]).finally(() => clearTimeout(timer));
  }

  // One command at a time: parallel commands would interleave on the one tab.
  let opChain = Promise.resolve();
  function serially(work) {
    const run = opChain.then(async () => {
      busy++;
      session.lastActivity = Date.now();
      try {
        // A frozen page must not hold every later command behind this one.
        return await withinOpTime(work);
      } finally {
        busy--;
        session.lastActivity = Date.now();
      }
    });
    opChain = run.catch(() => {});
    return run;
  }

  // The page the agent last saw. A ref it holds belongs to this page, not to one the person moved to.
  let agentPage = null;

  async function tabs(index) {
    const pages = session.context.pages();
    if (index === undefined) {
      const lines = await Promise.all(pages.map((p, i) => tabLine(p, i, session.activePage)));
      return `Open tabs (* is the one you act on):\n${lines.join("\n")}`;
    }
    const page = pages[Number(index) - 1];
    if (!page) return null;
    await session.switchTo(page);
    agentPage = page;
    return pageView(page);
  }

  async function runOp(op, args = {}, run = {}) {
    if (session.personActive())
      return agentError("user_in_control", "A person is controlling the browser.", {
        next_step: 'Run `agenta-browser wait "<why>"` and continue when it returns.',
      });
    session.setControl("agent");
    try {
      if (op === "tab") {
        const text = await tabs(args.index);
        return text === null
          ? agentError("invalid_arguments", `There is no tab ${args.index}. Run \`agenta-browser tab\` to list them.`)
          : { ok: true, text };
      }
      const handler = OPS[op];
      if (!handler) return agentError("invalid_arguments", `Unknown command ${op}.`);
      // A browser's first tab is blank: a new tab would leave it behind, empty.
      const newTab = args.newTab && session.activePage?.url() !== "about:blank";
      const previous = newTab ? session.activePage : null;
      const page = newTab ? await session.openTab() : await session.currentPage();
      if (args.ref && agentPage && page !== agentPage)
        return agentError("tab_changed", "The person moved to another tab. Nothing was done.", {
          next_step: "Run `agenta-browser read` and use a ref from the new result.",
        });
      const before = new Set(session.context.pages());
      const text = await handler(page, { ...args, run }).catch(async (e) => {
        // A refused or failed site leaves no blank tab behind, and the agent where it was.
        if (newTab && !run.stopped) {
          if (previous && !previous.isClosed()) await session.switchTo(previous);
          await page.close().catch(() => {});
        }
        throw e;
      });
      if (run.stopped) return null;
      agentPage = page;
      const all = session.context.pages();
      const opened = all.filter((p) => !before.has(p));
      await session.saveState().catch((e) => log(`save failed: ${errorText(e)}`));
      return { ok: true, text: text + (await newTabsNote(opened, all)) };
    } catch (e) {
      return opError(e);
    }
  }

  async function waitForPerson(rawReason) {
    const reason = String(rawReason || "The agent needs your help in the browser.").slice(0, 300);
    session.lastActivity = Date.now();
    const outcome = await waits.wait(reason);
    session.lastActivity = Date.now();
    if (outcome === "still")
      return {
        ok: true,
        text:
          `Still waiting: the person has not clicked I'm done yet ("${reason}").\n` +
          "Run wait again to keep waiting.",
      };
    if (outcome === "expired")
      return agentError("wait_timeout", `Nobody clicked I'm done within ${Math.round(config.WAIT_TOTAL_MS / 60_000)} minutes.`, {
        next_step: "Tell the person what you need and stop. They can reply when they are ready.",
      });
    await session.saveState().catch(() => {});
    agentPage = await session.currentPage();
    // The click is already spent: a frozen page must not lose it to the CLI's time limit.
    const view = await within(pageView(agentPage), 10_000, "The page is not responding. Run `agenta-browser tab`.");
    return { ok: true, text: `The person is done.\n${view}` };
  }

  async function shutdown(code) {
    await session.saveState().catch(() => {});
    await session.browser?.close().catch(() => {});
    process.exit(code);
  }

  const isLoopback = (address = "") =>
    address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");

  async function route(req, res) {
    if (!authorized(req)) return reply(res, 401, { ok: false });
    const url = new URL(req.url, "http://browser");
    if (req.method === "GET" && url.pathname === "/health") {
      if (!session.connected()) return reply(res, 503, { ok: false });
      // The app shows this without opening the live view: the page, and the agent's ask.
      // A frozen page must not stop this answering: a silent /health gets the browser restarted.
      const active = (await session.tabs()).find((tab) => tab.active);
      return reply(res, 200, {
        ok: true,
        wait_reason: waits.reason(),
        url: active?.url ?? "",
        title: active?.title ?? "",
      });
    }
    if (req.method !== "POST") return reply(res, 404, { ok: false });
    if (!isLoopback(req.socket.remoteAddress)) return reply(res, 403, { ok: false });
    const body = await readJson(req);
    if (url.pathname === "/op")
      return reply(res, 200, await serially((run) => runOp(String(body.op || ""), body.args || {}, run)).catch(opError));
    if (url.pathname === "/wait") return reply(res, 200, await waitForPerson(body.reason));
    if (url.pathname === "/save") {
      const saved = await session.saveState();
      return reply(res, 200, { ok: true, text: saved ? "Saved the sign-ins." : "Nothing changed." });
    }
    if (url.pathname === "/stop") {
      reply(res, 200, { ok: true, text: "Stopped." });
      return shutdown(0);
    }
    return reply(res, 404, { ok: false });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => reply(res, 500, agentError("browser_error", errorText(e))));
  });
  const wss = webSocketServer({ noServer: true, maxPayload: config.MAX_BODY_BYTES });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://browser").pathname !== "/live" || !authorized(req)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, live.attachViewer);
  });

  // Listen before launching Chromium: the port decides which of two racing starts is the browser.
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.PORT, "0.0.0.0", resolve);
    });
  } catch (e) {
    log(`not serving: ${e.code === "EADDRINUSE" ? `port ${config.PORT} is in use` : errorText(e)}`);
    process.exit(1);
  }
  log(`listening on ${config.PORT} as pid ${process.pid}`);
  writePrivate(config.PID_FILE, String(process.pid));
  // Remove only our own files: a newer browser may already have written its own.
  process.on("exit", () => {
    for (const [file, mine] of [
      [config.TOKEN_FILE, accessToken],
      [config.PID_FILE, String(process.pid)],
    ])
      try {
        if (fs.readFileSync(file, "utf8") === mine) fs.rmSync(file, { force: true });
      } catch {}
  });
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
  session.on("disconnected", () => {
    log("Chromium disconnected");
    process.exit(1);
  });

  await session.launch();
  // Written last: a token file means the browser is ready.
  writePrivate(config.TOKEN_FILE, accessToken);
  session.lastActivity = Date.now();
  log("ready");

  setInterval(() => {
    if (Date.now() - session.lastInput < config.SAVE_AFTER_INPUT_MS)
      session.saveState().catch((e) => log(`save failed: ${errorText(e)}`));
  }, config.SAVE_EVERY_MS).unref();

  const idleCheck = setInterval(
    () => {
      const idle = Date.now() - session.lastActivity >= config.IDLE_EXIT_MS;
      if (idle && !busy && !live.viewerCount() && !waits.active()) {
        clearInterval(idleCheck);
        log("idle, stopping");
        shutdown(0);
      }
    },
    Math.min(60_000, config.IDLE_EXIT_MS / 4),
  );
}

module.exports = { serve };
