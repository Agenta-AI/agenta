"use strict";

// The real CLI against a real Chromium and a local page. Skipped when playwright-core or its
// Chromium is not installed (set NODE_PATH to the node_modules that holds playwright-core).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { ENTRY } = require("./lib.cjs");

function findPlaywright() {
  const root = path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules");
  const paths = [...(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean), root, path.join(root, "playwright", "node_modules")];
  try {
    const resolved = require.resolve("playwright-core", { paths });
    const executable = require(resolved).chromium.executablePath();
    return fs.existsSync(executable) ? path.dirname(path.dirname(resolved)) : null;
  } catch {
    return null;
  }
}

const NODE_MODULES = findPlaywright();

const PAGES = {
  "/": `<title>Shop</title>
    <h1>Shop</h1>
    <div><input aria-label="Search the shop" onkeydown="if (event.key === 'Enter') out.textContent = 'Searched ' + this.value"><button>Search</button></div>
    <div><input aria-label="Coupon"><button>Place order</button></div>
    <form onsubmit="event.preventDefault()"><input aria-label="Card name"><button type="submit">Pay now</button></form>
    <button onclick="this.textContent='Account deleted'">Delete account</button>
    <label><input type="checkbox"> Delete my data</label>
    <label><input type="checkbox"> Email me news</label>
    <a href="/next" target="_blank">Open help</a>
    <p id="out"></p>`,
  "/next": "<title>Help</title><h1>Help page</h1>",
};

function serveFixture() {
  const server = http.createServer((req, res) => {
    const body = PAGES[new URL(req.url, "http://x").pathname];
    res.writeHead(body ? 200 : 404, { "content-type": "text/html", "set-cookie": "sid=s1; Path=/; Max-Age=3600" });
    res.end(body || "");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function makeCli(env, cwd) {
  return (...args) =>
    new Promise((resolve) => {
      execFile(process.execPath, [ENTRY, ...args], { cwd, env, timeout: 120_000 }, (error, stdout, stderr) =>
        resolve({ code: error ? error.code ?? 1 : 0, out: stdout + stderr }),
      );
    });
}

const refOf = (text, pattern) => {
  const match = text.match(new RegExp(`${pattern}[^\\n]*\\[ref=([a-z0-9]+)\\]`));
  assert.ok(match, `no ref for ${pattern} in:\n${text}`);
  return match[1];
};

test("open, read, click, type, set, tabs, wait and the pay refusal through the real CLI", { skip: !NODE_MODULES && "playwright-core with Chromium is not installed", timeout: 240_000 }, async (t) => {
  const site = await serveFixture();
  const url = `http://127.0.0.1:${site.address().port}/`;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-smoke-"));
  fs.mkdirSync(path.join(cwd, "agent-files"));
  const runDir = path.join(cwd, "run");
  const port = await freePort();
  const env = {
    ...process.env,
    NODE_PATH: NODE_MODULES,
    AGENTA_BROWSER_ALLOW_SHARED_HOST: "1",
    AGENTA_BROWSER_DIR: runDir,
    AGENTA_BROWSER_PORT: String(port),
    AGENTA_BROWSER_WAIT_SLICE_MS: "1500",
  };
  delete env.DAYTONA_SANDBOX_ID;
  delete env.AGENTA_BROWSER_STATE;
  const cli = makeCli(env, cwd);
  t.after(async () => {
    await cli("stop");
    site.close();
  });

  // Two first commands at once start one server.
  const [first, second] = await Promise.all([cli("open", url), cli("open", url)]);
  assert.equal(first.code, 0, first.out);
  assert.equal(second.code, 0, second.out);
  const log = fs.readFileSync(path.join(runDir, "browser.log"), "utf8");
  assert.equal(log.match(/listening on/g).length, 1, log);

  const token = fs.readFileSync(path.join(runDir, "token"), "utf8");
  const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-agenta-browser-token": token } });
  assert.equal(health.status, 200);

  // A command from another directory uses the same sign-in file.
  const page = await makeCli(env, os.tmpdir())("read");
  assert.match(page.out, /^Page: Shop \(/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, "agent-files", ".agenta-browser", "state.json"), "utf8")).cookies.map((c) => c.name), ["sid"]);

  const search = await cli("type", refOf(page.out, 'textbox "Search the shop"'), "--submit", "--", "--shoes");
  assert.equal(search.code, 0, search.out);
  assert.match(search.out, /Searched --shoes/);

  const pay = await cli("type", refOf(page.out, 'textbox "Card name"'), "Ada", "--submit");
  assert.equal(pay.code, 1);
  assert.match(pay.out, /^Error \(needs_approval\): That form looks like it pays or orders something\. Nothing was done\./);

  const order = await cli("type", refOf(page.out, 'textbox "Coupon"'), "SAVE10", "--submit");
  assert.equal(order.code, 1);
  assert.match(order.out, /needs_approval/);

  const deleteRef = refOf(page.out, 'button "Delete account"');
  const refused = await cli("click", deleteRef);
  assert.equal(refused.code, 1);
  assert.match(refused.out, /--intent delete/);
  const approved = await cli("click", deleteRef, "--intent", "delete");
  assert.equal(approved.code, 0, approved.out);
  assert.match(approved.out, /Account deleted/);

  const box = await cli("set", refOf(page.out, 'checkbox "Delete my data"'), "true");
  assert.match(box.out, /needs_approval/);
  const news = await cli("set", refOf(page.out, 'checkbox "Email me news"'), "true");
  assert.equal(news.code, 0, news.out);

  const popup = await cli("click", refOf(page.out, 'link "Open help"'));
  assert.equal(popup.code, 0, popup.out);
  assert.match(popup.out, /A new tab opened; you are still on the same tab\./);
  assert.match(popup.out, / 2\. Help \(http:\/\/127\.0\.0\.1:\d+\/next\)/);
  assert.match((await cli("read")).out, /^Page: Shop/);
  assert.match((await cli("tab", "2")).out, /^Page: Help/);

  // A wait slice ends with Still waiting; the live view's "I'm done" ends the next one.
  const still = await cli("wait", "Please", "sign", "in");
  assert.equal(still.code, 0, still.out);
  assert.match(still.out, /^Still waiting: the person has not clicked I'm done yet \("Please sign in"\)\./);
  const waiting = cli("wait", "Please", "sign", "in");
  const { ws: WebSocket } = require(path.join(NODE_MODULES, "playwright-core", "lib", "utilsBundle"));
  const viewer = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { "x-agenta-browser-token": token } });
  const statuses = [];
  viewer.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === "status") statuses.push(message);
  });
  await new Promise((resolve) => viewer.on("open", resolve));
  await new Promise((resolve) => setTimeout(resolve, 300));
  viewer.send(JSON.stringify({ type: "done" }));
  const done = await waiting;
  viewer.close();
  assert.equal(done.code, 0, done.out);
  assert.match(done.out, /^The person is done\.\nPage: Help/);
  assert.equal(statuses[0].waiting, "Please sign in");

  const stop = await cli("stop");
  assert.equal(stop.out.trim(), "Stopped.");
  assert.equal(fs.existsSync(path.join(runDir, "token")), false);
  assert.equal(fs.existsSync(path.join(runDir, "pid")), false);
});

test("the browser stops by itself when nobody uses it", { skip: !NODE_MODULES && "playwright-core with Chromium is not installed", timeout: 120_000 }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-idle-"));
  const runDir = path.join(cwd, "run");
  const env = {
    ...process.env,
    NODE_PATH: NODE_MODULES,
    AGENTA_BROWSER_ALLOW_SHARED_HOST: "1",
    AGENTA_BROWSER_DIR: runDir,
    AGENTA_BROWSER_PORT: String(await freePort()),
    AGENTA_BROWSER_IDLE_MS: "1000",
  };
  const cli = makeCli(env, cwd);
  assert.equal((await cli("read")).code, 0);
  const pid = Number(fs.readFileSync(path.join(runDir, "pid"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal((await cli("stop")).out.trim(), "The browser is not running.");
});

test("without a Daytona sandbox the browser refuses to start", async () => {
  const env = { ...process.env, AGENTA_BROWSER_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-refuse-")) };
  delete env.DAYTONA_SANDBOX_ID;
  delete env.AGENTA_BROWSER_ALLOW_SHARED_HOST;
  const result = await makeCli(env, os.tmpdir())("open", "example.com");
  assert.equal(result.code, 1);
  assert.match(result.out, /^Error \(browser_unavailable\): The browser is not available on this deployment/);
  assert.deepEqual(fs.readdirSync(env.AGENTA_BROWSER_DIR), []);
});
