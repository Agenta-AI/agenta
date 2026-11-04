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
  "/rerender": `<title>Search</title><input aria-label="Find"><p id="out"></p><script>
    const first = document.querySelector("input");
    first.addEventListener("focus", () => setTimeout(() => {
      const next = document.createElement("input");
      next.setAttribute("aria-label", "Find");
      next.value = first.value;
      next.onkeydown = (e) => { if (e.key === "Enter") out.textContent = "Searched " + next.value; };
      first.replaceWith(next);
      next.focus();
    }, 40));
  </script>`,
  "/spin": `<title>Spin</title><script>localStorage.setItem("k", "v")</script><button onclick="for (;;);">Freeze</button>`,
  "/to-frame": `<title>To frame</title><input aria-label="Name" onfocus="document.querySelector('iframe').contentDocument.querySelector('input').focus()"><iframe srcdoc="<input type=password aria-label=Secret>"></iframe>`,
  "/to-button": `<title>To button</title><input aria-label="Name" onfocus="document.querySelector('button').focus()"><button onclick="this.textContent='Account deleted'">Delete account</button>`,
  "/field": `<title>Field</title><input aria-label="Name" value="old" oninput="document.title = 'Length ' + this.value.length">`,
  "/signed-in": "<title>Account</title><h1>Welcome back</h1>",
  "/framed": `<title>Framed</title><h1>Outer page</h1><iframe src="/consent" title="Consent"></iframe>`,
  "/consent": `<button onclick="this.textContent='Rejected'">Reject all</button><button>Pay with card</button>`,
  "/login": `<title>Login</title><input aria-label="Email"><input aria-label="Password" type="password"><input aria-label="Code" autocomplete="one-time-code">`,
};

function serveFixture() {
  const server = http.createServer((req, res) => {
    if (req.url === "/hang") return;
    const body = PAGES[new URL(req.url, "http://x").pathname];
    const pathname = new URL(req.url, "http://x").pathname;
    const cookies = ["sid=s1; Path=/; Max-Age=3600"];
    if (pathname === "/signed-in") cookies.push("login=yes; Path=/; Max-Age=3600");
    res.writeHead(body ? 200 : 404, { "content-type": "text/html", "set-cookie": cookies });
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
  // A second viewer of the same idle page still gets a first frame.
  const secondViewer = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { "x-agenta-browser-token": token } });
  const secondFrame = new Promise((resolve) =>
    secondViewer.on("message", (raw) => JSON.parse(String(raw)).type === "frame" && resolve(true)),
  );
  assert.equal(await Promise.race([secondFrame, new Promise((r) => setTimeout(() => r(false), 5_000))]), true);
  secondViewer.close();
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

test("the agent opens tabs, a viewer sees and switches them, and an old ref is refused", { skip: !NODE_MODULES && "playwright-core with Chromium is not installed", timeout: 120_000 }, async (t) => {
  const site = await serveFixture();
  const origin = `http://127.0.0.1:${site.address().port}`;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-tabs-"));
  const port = await freePort();
  const runDir = path.join(cwd, "run");
  const env = {
    ...process.env,
    NODE_PATH: NODE_MODULES,
    AGENTA_BROWSER_ALLOW_SHARED_HOST: "1",
    AGENTA_BROWSER_DIR: runDir,
    AGENTA_BROWSER_PORT: String(port),
  };
  const cli = makeCli(env, cwd);
  t.after(async () => {
    await cli("stop");
    site.close();
  });

  const shop = await cli("open", `${origin}/`, "--new-tab");
  assert.doesNotMatch((await cli("tab")).out, /about:blank/);
  const help = await cli("open", `${origin}/next`, "--new-tab");
  assert.equal(help.code, 0, help.out);
  assert.match(help.out, /^Page: Help/);
  assert.doesNotMatch(help.out, /new tab opened/);
  assert.match((await cli("tab")).out, /  1\. Shop .*\n\* 2\. Help/);

  const refused = await cli("open", "file:///etc/passwd", "--new-tab");
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /site_not_allowed/);
  const after = await cli("tab");
  assert.match(after.out, /\* 2\. Help/);
  assert.doesNotMatch(after.out, / 3\. /);

  const { ws: WebSocket } = require(path.join(NODE_MODULES, "playwright-core", "lib", "utilsBundle"));
  const token = fs.readFileSync(path.join(runDir, "token"), "utf8");
  const viewer = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { "x-agenta-browser-token": token } });
  let status = null;
  viewer.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === "status") status = message;
  });
  const until = async (done) => {
    for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(done(), JSON.stringify(status));
  };
  await until(() => status);
  assert.deepEqual(status.tabs.map(({ title, active }) => [title, active]), [["Shop", false], ["Help", true]]);

  await cli("tab", "2");
  const helpRead = await cli("read");
  viewer.send(JSON.stringify({ type: "tab", id: status.tabs[0].id }));
  await until(() => status.title === "Shop" && status.control === "user");
  assert.deepEqual(status.tabs.map(({ active }) => active), [true, false]);
  viewer.send(JSON.stringify({ type: "control", take: false }));
  await until(() => status.control === "agent");

  const stale = await cli("click", refOf(shop.out, 'link "Open help"'));
  assert.equal(stale.code, 1, stale.out);
  assert.match(stale.out, /tab_changed/);
  assert.match(helpRead.out, /^Page: Help/);
  assert.match((await cli("read")).out, /^Page: Shop/);
  viewer.close();
});

test("a sign-in survives a killed browser when the person never clicked I'm done", { skip: !NODE_MODULES && "playwright-core with Chromium is not installed", timeout: 60_000 }, async (t) => {
  const site = await serveFixture();
  const origin = `http://127.0.0.1:${site.address().port}`;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-autosave-"));
  fs.mkdirSync(path.join(cwd, "agent-files"));
  const port = await freePort();
  const runDir = path.join(cwd, "run");
  const env = {
    ...process.env,
    NODE_PATH: NODE_MODULES,
    AGENTA_BROWSER_ALLOW_SHARED_HOST: "1",
    AGENTA_BROWSER_DIR: runDir,
    AGENTA_BROWSER_PORT: String(port),
    AGENTA_BROWSER_SAVE_EVERY_MS: "100",
  };
  const cli = makeCli(env, cwd);
  t.after(async () => {
    await cli("stop");
    site.close();
  });

  await cli("open", `${origin}/`);
  const { ws: WebSocket } = require(path.join(NODE_MODULES, "playwright-core", "lib", "utilsBundle"));
  const token = fs.readFileSync(path.join(runDir, "token"), "utf8");
  const viewer = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { "x-agenta-browser-token": token } });
  await new Promise((resolve) => viewer.on("open", resolve));
  viewer.send(JSON.stringify({ type: "navigate", url: `${origin}/signed-in` }));

  const saved = () => {
    try {
      const file = path.join(cwd, "agent-files", ".agenta-browser", "state.json");
      return JSON.parse(fs.readFileSync(file, "utf8")).cookies.map((c) => c.name);
    } catch {
      return [];
    }
  };
  for (let i = 0; i < 60 && !saved().includes("login"); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  process.kill(Number(fs.readFileSync(path.join(runDir, "pid"), "utf8")), "SIGKILL");
  viewer.terminate();
  assert.ok(saved().includes("login"), `saved cookies: ${saved()}`);
});

test("typing reaches a field that replaces itself on focus", { skip: !NODE_MODULES && "playwright-core with Chromium is not installed", timeout: 60_000 }, async (t) => {
  const site = await serveFixture();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-rerender-"));
  const env = { ...process.env, NODE_PATH: NODE_MODULES, AGENTA_BROWSER_ALLOW_SHARED_HOST: "1", AGENTA_BROWSER_DIR: path.join(cwd, "run"), AGENTA_BROWSER_PORT: String(await freePort()) };
  const cli = makeCli(env, cwd);
  t.after(async () => {
    await cli("stop");
    site.close();
  });
  const page = await cli("open", `http://127.0.0.1:${site.address().port}/rerender`);
  const typed = await cli("type", refOf(page.out, 'textbox "Find"'), "shoes", "--submit");
  assert.equal(typed.code, 0, typed.out);
  assert.match(typed.out, /Searched shoes/);
});

test("a site that never answers is a timeout, and a frozen page keeps the browser and its tabs", { skip: !NODE_MODULES && "playwright-core with Chromium is not installed", timeout: 120_000 }, async (t) => {
  const site = await serveFixture();
  const origin = `http://127.0.0.1:${site.address().port}`;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-stuck-"));
  const env = { ...process.env, NODE_PATH: NODE_MODULES, AGENTA_BROWSER_ALLOW_SHARED_HOST: "1", AGENTA_BROWSER_DIR: path.join(cwd, "run"), AGENTA_BROWSER_PORT: String(await freePort()), AGENTA_BROWSER_OP_TIMEOUT_MS: "35000" };
  const cli = makeCli(env, cwd);
  t.after(async () => {
    await cli("stop");
    site.closeAllConnections();
    site.close();
  });
  await cli("open", `${origin}/next`);
  const hung = await cli("open", `${origin}/hang`);
  assert.equal(hung.code, 1, hung.out);
  assert.match(hung.out, /page_timeout/);

  const spin = await cli("open", `${origin}/spin`, "--new-tab");
  const frozen = cli("click", refOf(spin.out, 'button "Freeze"'));
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const tabs = await cli("tab");
  assert.equal((await frozen).code, 1);
  assert.match(tabs.out, / 1\. .*\n.* 2\. /);
});

const stuckEnv = async (cwd, extra = {}) => ({
  ...process.env,
  NODE_PATH: NODE_MODULES,
  AGENTA_BROWSER_ALLOW_SHARED_HOST: "1",
  AGENTA_BROWSER_DIR: path.join(cwd, "run"),
  AGENTA_BROWSER_PORT: String(await freePort()),
  ...extra,
});

const openViewer = async (env) => {
  const { ws: WebSocket } = require(path.join(NODE_MODULES, "playwright-core", "lib", "utilsBundle"));
  const token = fs.readFileSync(path.join(env.AGENTA_BROWSER_DIR, "token"), "utf8");
  const socket = new WebSocket(`ws://127.0.0.1:${env.AGENTA_BROWSER_PORT}/live`, { headers: { "x-agenta-browser-token": token } });
  const viewer = { socket, status: null, send: (m) => socket.send(JSON.stringify(m)) };
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === "status") viewer.status = message;
  });
  await new Promise((resolve) => socket.on("open", resolve));
  return viewer;
};

const until = async (done, ms = 8_000) => {
  for (let at = Date.now(); Date.now() - at < ms && !done(); ) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(done());
};

test("a frozen tab on its own site blocks neither the agent nor the person", { skip: !NODE_MODULES && "playwright-core with Chromium is not installed", timeout: 90_000 }, async (t) => {
  const site = await serveFixture();
  const port = site.address().port;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-frozen-"));
  const env = await stuckEnv(cwd, { AGENTA_BROWSER_OP_TIMEOUT_MS: "20000", AGENTA_BROWSER_WAIT_SLICE_MS: "15000" });
  const cli = makeCli(env, cwd);
  t.after(async () => {
    await cli("stop");
    site.close();
  });
  await cli("open", `http://localhost:${port}/next`);
  const spin = await cli("open", `http://127.0.0.1:${port}/spin`, "--new-tab");
  await cli("click", refOf(spin.out, 'button "Freeze"'));

  await cli("tab", "1");
  const started = Date.now();
  const read = await cli("read");
  assert.equal(read.code, 0, read.out);
  assert.match(read.out, /^Page: Help/);
  assert.ok(Date.now() - started < 8_000, "read waited on the frozen tab");

  await cli("tab", "2");
  const viewer = await openViewer(env);
  await until(() => viewer.status);
  viewer.send({ type: "mouse", event: "move", x: 5, y: 5 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const waiting = cli("wait", "Fix this");
  await new Promise((resolve) => setTimeout(resolve, 300));
  viewer.send({ type: "tab", id: viewer.status.tabs[0].id });
  await until(() => viewer.status.title === "Help");
  viewer.send({ type: "done" });
  assert.match((await waiting).out, /^The person is done\.\nPage: Help/);
  viewer.socket.close();
});

test("typing goes only into an editable, non-secret field that holds focus", { skip: !NODE_MODULES && "playwright-core with Chromium is not installed", timeout: 60_000 }, async (t) => {
  const site = await serveFixture();
  const origin = `http://127.0.0.1:${site.address().port}`;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-typing-"));
  const cli = makeCli(await stuckEnv(cwd), cwd);
  t.after(async () => {
    await cli("stop");
    site.close();
  });

  const frame = await cli("open", `${origin}/to-frame`);
  assert.match((await cli("type", refOf(frame.out, 'textbox "Name"'), "hunter2")).out, /secret_field/);

  const button = await cli("open", `${origin}/to-button`);
  const typed = await cli("type", refOf(button.out, 'textbox "Name"'), "a b");
  assert.equal(typed.code, 1, typed.out);
  assert.doesNotMatch((await cli("read")).out, /Account deleted/);

  const field = await cli("open", `${origin}/field`);
  const cleared = await cli("type", refOf(field.out, 'textbox "Name"'), "");
  assert.equal(cleared.code, 0, cleared.out);
  assert.doesNotMatch((await cli("read")).out, /old/);
});

test("a command past its time limit stops typing", { skip: !NODE_MODULES && "playwright-core with Chromium is not installed", timeout: 60_000 }, async (t) => {
  const site = await serveFixture();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-cancel-"));
  const cli = makeCli(await stuckEnv(cwd, { AGENTA_BROWSER_OP_TIMEOUT_MS: "1500" }), cwd);
  t.after(async () => {
    await cli("stop");
    site.close();
  });
  const page = await cli("open", `http://127.0.0.1:${site.address().port}/field`);
  const typed = await cli("type", refOf(page.out, 'textbox "Name"'), "x".repeat(400));
  assert.match(typed.out, /page_stuck/);
  const length = async () => (await cli("tab")).out.match(/Length \d+/)?.[0];
  await new Promise((resolve) => setTimeout(resolve, 300));
  const stopped = await length();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  assert.equal(await length(), stopped);
});

test("control goes back when the viewer who took it leaves, though another still watches", { skip: !NODE_MODULES && "playwright-core with Chromium is not installed", timeout: 60_000 }, async (t) => {
  const site = await serveFixture();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-handback-"));
  const env = await stuckEnv(cwd);
  const cli = makeCli(env, cwd);
  t.after(async () => {
    await cli("stop");
    site.close();
  });
  await cli("open", `http://127.0.0.1:${site.address().port}/next`);
  const pane = await openViewer(env);
  const preview = await openViewer(env);
  await until(() => pane.status && preview.status);
  pane.send({ type: "control", take: true });
  await until(() => preview.status.control === "user");
  pane.socket.close();
  await until(() => preview.status.control === "agent");
  preview.socket.close();
});

test("refs inside an iframe work and checks hold there; secret fields are never typed into", { skip: !NODE_MODULES && "playwright-core with Chromium is not installed", timeout: 120_000 }, async (t) => {
  const site = await serveFixture();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-frame-"));
  const env = {
    ...process.env,
    NODE_PATH: NODE_MODULES,
    AGENTA_BROWSER_ALLOW_SHARED_HOST: "1",
    AGENTA_BROWSER_DIR: path.join(cwd, "run"),
    AGENTA_BROWSER_PORT: String(await freePort()),
  };
  const cli = makeCli(env, cwd);
  t.after(async () => {
    await cli("stop");
    site.close();
  });
  const page = await cli("open", `http://127.0.0.1:${site.address().port}/framed`);
  assert.equal(page.code, 0, page.out);
  const reject = refOf((await cli("find", "Reject")).out, 'button "Reject all"');
  assert.match((await cli("read", reject)).out, /button "Reject all"/);
  const clicked = await cli("click", reject);
  assert.equal(clicked.code, 0, clicked.out);
  assert.match((await cli("find", "Rejected")).out, /button "Rejected"/);
  const pay = refOf((await cli("find", "Pay with")).out, 'button "Pay with card"');
  const refused = await cli("click", pay);
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /^Error \(needs_approval\)/);

  const login = await cli("open", `http://127.0.0.1:${site.address().port}/login`);
  assert.equal((await cli("type", refOf(login.out, 'textbox "Email"'), "me@example.com")).code, 0);
  for (const field of ['textbox "Password"', 'textbox "Code"']) {
    const typed = await cli("type", refOf(login.out, field), "123456");
    assert.equal(typed.code, 1, typed.out);
    assert.match(typed.out, /^Error \(secret_field\)/);
  }
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
