// Runs next to Chromium, in a browser sandbox or as a local runner child; the API is the only caller.
"use strict";

const http = require("node:http");
const net = require("node:net");
const dns = require("node:dns").promises;
const crypto = require("node:crypto");

const PORT = Number(process.env.AGENTA_BROWSER_PORT || 8790);
const PROXY_PORT = Number(process.env.AGENTA_BROWSER_PROXY_PORT || 3128);
// The runner sets it for a local child and a Daytona sandbox alike; without it nothing is served.
const ACCESS_TOKEN = process.env.AGENTA_BROWSER_TOKEN || "";
const IDLE_EXIT_MS = Number(process.env.AGENTA_BROWSER_IDLE_EXIT_MS || 0);
const VIEWPORT = { width: 1280, height: 800 };
const BLOCKED_HEADER = "x-agenta-blocked";
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 30_000;
const ACTION_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 30_000;

// ---- egress proxy: resolve once, refuse private ranges, connect to the checked address ----

function ipv4Blocked(ip) {
  const p = ip.split(".").map(Number);
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

// Eight 16-bit groups. Chrome sends IPv4-mapped addresses in hex (`::ffff:7f00:1`), not dotted.
function ipv6Groups(ip) {
  let s = ip.toLowerCase().split("%")[0];
  const dotted = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    s = `${s.slice(0, -dotted[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  if (tail === undefined) return h.map((g) => parseInt(g, 16));
  const t = tail ? tail.split(":") : [];
  return [...h, ...Array(8 - h.length - t.length).fill("0"), ...t].map((g) =>
    parseInt(g, 16),
  );
}

function ipBlocked(ip) {
  if (net.isIPv4(ip)) return ipv4Blocked(ip);
  const g = ipv6Groups(ip);
  // ::/96 (`::`, `::1`, IPv4-compatible) and ::ffff:0:0/96 (IPv4-mapped) carry an IPv4 address.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) {
    return ipv4Blocked(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  return (
    (g[0] & 0xfe00) === 0xfc00 ||
    (g[0] & 0xffc0) === 0xfe80 ||
    (g[0] & 0xffc0) === 0xfec0 ||
    (g[0] & 0xff00) === 0xff00 ||
    (g[0] === 0x64 && g[1] === 0xff9b) ||
    (g[0] === 0x2001 && g[1] === 0xdb8)
  );
}

async function resolvePublic(host) {
  const bare = host.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    if (ipBlocked(bare)) throw new Error(`blocked address ${bare}`);
    return bare;
  }
  const addresses = await dns.lookup(bare, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => ipBlocked(a.address))) {
    throw new Error(`blocked host ${bare}`);
  }
  return (addresses.find((a) => a.family === 4) || addresses[0]).address;
}

function startProxy() {
  const server = http.createServer(async (req, res) => {
    let target;
    try {
      target = new URL(req.url);
    } catch {
      res.writeHead(400).end();
      return;
    }
    try {
      const address = await resolvePublic(target.hostname);
      const upstream = http.request(
        {
          host: address,
          port: target.port || 80,
          method: req.method,
          path: target.pathname + target.search,
          headers: { ...req.headers, host: target.host },
        },
        (up) => {
          res.writeHead(up.statusCode || 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", () => res.destroy());
      req.pipe(upstream);
    } catch {
      res.writeHead(403, { [BLOCKED_HEADER]: "1" }).end();
    }
  });
  server.on("connect", async (req, client, head) => {
    const [host, portText] = splitHostPort(req.url || "");
    try {
      const address = await resolvePublic(host);
      const upstream = net.connect(Number(portText) || 443, address, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }
  });
  return new Promise((resolve) =>
    server.listen(PROXY_PORT, "127.0.0.1", () =>
      resolve(server.address().port),
    ),
  );
}

function splitHostPort(value) {
  const v6 = value.match(/^\[([^\]]+)\]:(\d+)$/);
  if (v6) return [v6[1], v6[2]];
  const i = value.lastIndexOf(":");
  return i === -1 ? [value, ""] : [value.slice(0, i), value.slice(i + 1)];
}

// ---- allowlist ----

let allowedHosts = [];

function hostAllowed(host) {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((a) => h === a || h.endsWith(`.${a}`));
}

function navigationAllowed(rawUrl) {
  if (rawUrl === "about:blank") return true;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (
    net.isIP(u.hostname.replace(/^\[|\]$/g, "")) ||
    u.hostname === "localhost"
  )
    return false;
  return hostAllowed(u.hostname);
}

// What a page may show: an allowed site, a blank or error page, or a blob of an allowed site.
function documentAllowed(rawUrl) {
  if (/^(about|chrome-error):/.test(rawUrl)) return true;
  if (rawUrl.startsWith("blob:")) {
    try {
      return navigationAllowed(new URL(rawUrl).origin);
    } catch {
      return false;
    }
  }
  return navigationAllowed(rawUrl);
}

// ---- browser state ----

let browser;
let context;
let activePage;
let generation = null;
let control = "agent";
let lastCookieHash = "";
let exportedCookieHash = "";
let setupPromise = null;
const viewers = new Set();
let screencast = null;

const fail = (code, message, extra) =>
  Object.assign(new Error(message), { code, ...extra });

function agentError(code, message, { retryable = false, next_step } = {}) {
  return {
    ok: false,
    error: { code, message, retryable, ...(next_step ? { next_step } : {}) },
  };
}

async function launch(proxyPort) {
  const { chromium } = require("playwright-core");
  browser = await chromium.launch({
    headless: true,
    // The full Chromium build, not the headless shell: sites such as x.com refuse the shell with 403.
    channel: "chromium",
    proxy: { server: `http://127.0.0.1:${proxyPort}`, bypass: "<-loopback>" },
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  });
  // A dead browser must take the controller down so the health check fails and the runner recreates the sandbox.
  browser.on("disconnected", () => process.exit(1));
}

async function setup({ allowedHosts: hosts, storageState, generation: gen }) {
  allowedHosts = (hosts || []).map((h) => String(h).toLowerCase());
  // Opaque to the controller: the API sends it and reads it back to guard its saves.
  generation = gen ?? null;
  const version = browser.version();
  context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
    locale: "en-US",
    timezoneId: "UTC",
    serviceWorkers: "block",
    acceptDownloads: false,
    ...(storageState ? { storageState } : {}),
  });
  context.on("page", (page) => {
    trackPage(page);
    setActivePage(page);
  });
  const page = await context.newPage();
  setActivePage(page);
  lastCookieHash = exportedCookieHash = await cookieHash();
}

const pageGuards = new WeakMap();

// Each page checks every document request (redirects and iframes included) through CDP. No
// `context.route`: it also pauses worker scripts and, on a cold cache, never lets some go.
async function guardPage(page) {
  const cdp = await context.newCDPSession(page);
  cdp.on("Fetch.requestPaused", ({ requestId, request }) => {
    const decision = navigationAllowed(request.url)
      ? cdp.send("Fetch.continueRequest", { requestId })
      : cdp.send("Fetch.failRequest", {
          requestId,
          errorReason: "BlockedByClient",
        });
    decision.catch(() => {});
  });
  await cdp.send("Fetch.enable", {
    patterns: [
      { urlPattern: "*", resourceType: "Document", requestStage: "Request" },
    ],
  });
  if (!documentAllowed(page.url()))
    await page.goto("about:blank").catch(() => {});
}

function trackPage(page) {
  pageGuards.set(
    page,
    guardPage(page).catch(() => {}),
  );
  page.on("close", () => {
    if (page !== activePage) return;
    const open = context.pages();
    setActivePage(open.length ? open[open.length - 1] : null);
  });
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    // A popup can start loading before its guard attaches: a document off the list never stays.
    if (!documentAllowed(frame.url())) {
      page.goto("about:blank").catch(() => {});
      return;
    }
    if (page === activePage) broadcastStatus();
  });
}

function setActivePage(page) {
  activePage = page;
  broadcastStatus();
  if (viewers.size) restartScreencast().catch(() => {});
}

async function cookieHash() {
  const cookies = await context.cookies();
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(cookies))
    .digest("hex");
}

async function currentPage() {
  if (!activePage || activePage.isClosed())
    setActivePage(await context.newPage());
  await pageGuards.get(activePage);
  if (!documentAllowed(activePage.url()))
    await activePage.goto("about:blank").catch(() => {});
  return activePage;
}

// ---- page text ----

const INTERACTIVE_ROLES =
  /^\s*- (button|link|textbox|searchbox|checkbox|radio|combobox|listbox|option|menuitem|menuitemcheckbox|menuitemradio|tab|switch|slider|spinbutton|treeitem)\b/;

function snapshotText(page) {
  return page.ariaSnapshot({ mode: "ai" });
}

function capped(text) {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return (
    text.slice(0, MAX_TEXT_CHARS) +
    "\n\n[Cut: the page is larger than the result limit. Call browser_read_page with the ref of the part you need, or browser_find with a word from it.]"
  );
}

const ITEM_ROLES = /^- (listitem|row|article|option|treeitem)\b/;
const MAX_FIND_MATCHES = 20;
const MAX_ITEM_LINES = 40;

const indentOf = (line) => line.length - line.trimStart().length;

// The nearest list item, row or article around line `i`, so a match comes back with its siblings.
function enclosingItem(lines, i) {
  let indent = indentOf(lines[i]);
  for (let j = i; j >= 0; j--) {
    if (indentOf(lines[j]) > indent || !lines[j].trim()) continue;
    indent = indentOf(lines[j]);
    if (ITEM_ROLES.test(lines[j].trimStart())) return j;
  }
  return i;
}

function itemBlock(lines, start) {
  const indent = indentOf(lines[start]);
  const block = [lines[start]];
  for (let j = start + 1; j < lines.length && indentOf(lines[j]) > indent; j++)
    block.push(lines[j]);
  const shown = block
    .slice(0, MAX_ITEM_LINES)
    .map((l) => l.slice(indent))
    .join("\n");
  return block.length > MAX_ITEM_LINES ? `${shown}\n[…]` : shown;
}

const MAX_OUTLINE_PARTS = 40;
const LIST_ROLES = /^- (list|table|rowgroup|listbox|tree|grid|feed)\b/;

function blockEnd(lines, i) {
  const indent = indentOf(lines[i]);
  let j = i + 1;
  while (j < lines.length && lines[j].trim() && indentOf(lines[j]) > indent)
    j++;
  return j;
}

function childStarts(lines, i) {
  const end = blockEnd(lines, i);
  const starts = [];
  for (let j = i + 1; j < end; j = blockEnd(lines, j)) starts.push(j);
  return starts;
}

function blockChars(lines, i) {
  let size = 0;
  for (let j = i; j < blockEnd(lines, i); j++) size += lines[j].length + 1;
  return size;
}

// Too long to show whole: list the page's parts, each with the ref that reads it, never a cut.
function outline(lines, total, partChars = MAX_TEXT_CHARS) {
  const part = (i) => ({
    i,
    size: blockChars(lines, i),
    kids: childStarts(lines, i),
  });
  const parts = [];
  for (let j = 0; j < lines.length; j = blockEnd(lines, j))
    if (lines[j].trim()) parts.push(part(j));
  for (;;) {
    const big = parts
      .filter(
        (p) =>
          p.size > partChars &&
          p.kids.length &&
          !LIST_ROLES.test(lines[p.i].trimStart()) &&
          parts.length - 1 + p.kids.length <= MAX_OUTLINE_PARTS,
      )
      .sort((x, y) => y.size - x.size)[0];
    if (!big) break;
    parts.splice(parts.indexOf(big), 1, ...big.kids.map(part));
  }
  if (parts.length === 1) return listWhole(lines, parts[0]);
  const rows = parts.map(({ i, size, kids }) => {
    const line = lines[i].trim().replace(/:$/, "");
    const items = LIST_ROLES.test(line) ? `, ${kids.length} items` : "";
    const name = line.includes('"') ? "" : ` ${preview(lines, i)}`;
    return `${line}${name} (${size.toLocaleString("en-US")} chars${items})`;
  });
  return (
    `[Outline of a long page (${total.toLocaleString("en-US")} chars). Read a part with ` +
    `browser_read_page and its ref, or act on a control by its role and name.]\n${rows.join("\n")}`
  );
}

function preview(lines, i) {
  const quoted = lines
    .slice(i, blockEnd(lines, i))
    .join(" ")
    .match(/"([^"]{1,60})/);
  return quoted ? `"${quoted[1]}…"` : "";
}

// One item on one line: its lines joined, so a long list still names every item and its ref.
function itemLine(lines, i) {
  const text = lines
    .slice(i, blockEnd(lines, i))
    .map((l) => l.trim().replace(/^- /, "").replace(/:$/, ""))
    .map((piece) => (piece.length > 100 ? `${piece.slice(0, 100)}…` : piece))
    .join(" · ");
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

// A part that cannot be split further, such as a long list: whole items first, then one line each.
function listWhole(lines, { i, kids }) {
  if (!kids.length)
    return capped(lines.slice(i, blockEnd(lines, i)).join("\n"));
  const indent = indentOf(lines[i]);
  const out = [lines[i].slice(indent)];
  let size = out[0].length;
  let k = 0;
  for (; k < kids.length; k++) {
    const block = lines
      .slice(kids[k], blockEnd(lines, kids[k]))
      .map((l) => l.slice(indent));
    const chars = block.join("\n").length + 1;
    if (size + chars > MAX_TEXT_CHARS / 2) break;
    out.push(...block);
    size += chars;
  }
  if (k < kids.length) {
    out.push(
      `[${kids.length - k} more items, one line each. Read an item by its ref for all of it.]`,
    );
    for (; k < kids.length; k++) out.push(`  - ${itemLine(lines, kids[k])}`);
  }
  return capped(out.join("\n"));
}

const SMALL_PAGE_CHARS = 8_000;

// A short page whole; a long one as an outline of parts small enough to read one at a time.
async function pageView(page) {
  const raw = await snapshotText(page);
  const header = await pageHeader(page);
  if (raw.length <= SMALL_PAGE_CHARS) return `${header}\n${raw}`;
  return `${header}\n${outline(raw.split("\n"), raw.length, SMALL_PAGE_CHARS)}`;
}

async function pageHeader(page) {
  return `Page: ${await page.title().catch(() => "")} (${page.url()})`;
}

function refLocator(page, ref) {
  const match = String(ref || "")
    .trim()
    .match(/^(?:ref[_=])?\[?(?:ref=)?([a-z0-9]+)\]?$/i);
  if (!match) return null;
  return page.locator(`aria-ref=${match[1]}`);
}

async function resolveRef(page, ref) {
  const locator = refLocator(page, ref);
  if (!locator) throw fail("invalid_arguments", "bad ref");
  if ((await locator.count().catch(() => 0)) === 0)
    throw fail("element_not_found", "no element");
  return locator;
}

let targetSeq = 0;

// Acts on exactly one element: a ref, or a role and name. Never guesses between several.
async function resolveTarget(page, { ref, role, name }) {
  if (ref) return resolveRef(page, ref);
  if (!role)
    throw fail("invalid_arguments", "Pass a ref, or a role and a name.");
  const locator = page.getByRole(
    String(role),
    name ? { name: String(name) } : {},
  );
  const count = await locator.count().catch((e) => {
    throw fail("invalid_arguments", String(e.message || e).split("\n")[0]);
  });
  if (count === 1) {
    // Pin the checked element: a role locator re-resolves, and a click can open look-alikes.
    const id = `t${++targetSeq}`;
    await locator.evaluate(
      (el, value) => el.setAttribute("data-agenta-target", value),
      id,
    );
    return page.locator(`[data-agenta-target="${id}"]`);
  }
  const candidates = await roleCandidates(
    page,
    String(role),
    name ? String(name) : "",
  );
  throw fail(count ? "ambiguous_target" : "element_not_found", candidates, {
    count,
  });
}

async function roleCandidates(page, role, name) {
  const lines = (await snapshotText(page))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith(`- ${role} `) || l === `- ${role}`);
  const named = lines.filter(
    (l) => !name || l.toLowerCase().includes(name.toLowerCase()),
  );
  const pick = named.length ? named : lines;
  const shown = pick.slice(0, 15).join("\n");
  return pick.length > 15 ? `${shown}\n[${pick.length - 15} more]` : shown;
}

// The lines `after` added to `before`, each under the unchanged line it sits in, and how many left.
function lineChanges(before, after) {
  const seen = new Map();
  for (const line of before) seen.set(line, (seen.get(line) || 0) + 1);
  const added = after.map((line) => {
    const left = seen.get(line) || 0;
    if (left) seen.set(line, left - 1);
    return !left;
  });
  const gone = [...seen.values()].reduce((sum, n) => sum + n, 0);
  const lines = [];
  after.forEach((line, i) => {
    if (!added[i]) return;
    for (let j = i - 1; j >= 0; j--) {
      if (indentOf(after[j]) < indentOf(line)) {
        const parent = `under: ${after[j].trim()}`;
        if (!added[j] && lines[lines.length - 1] !== parent) lines.push(parent);
        break;
      }
    }
    lines.push(line);
  });
  return { lines, gone };
}

async function changesSince(page, before, label, { mayNavigate = false } = {}) {
  // Single-page apps change the address after the click returns.
  if (mayNavigate) {
    const moved = await page
      .waitForURL((u) => u.href !== before.url, { timeout: 2_000 })
      .then(
        () => true,
        () => false,
      );
    if (moved)
      await page
        .waitForLoadState("networkidle", { timeout: 3_000 })
        .catch(() => {});
  }
  await settle(page);
  const now = await currentPage();
  if (now !== page || now.url() !== before.url)
    return `${label}\n${await pageView(now)}`;
  const { lines: out, gone } = lineChanges(
    before.lines,
    (await snapshotText(now)).split("\n"),
  );
  const header = `${label} ${await pageHeader(now)}`;
  if (!out.length)
    return gone
      ? `${header}\n${gone} lines left the page; nothing new appeared.`
      : `${header}\nNo change on the page.`;
  const changes = out.join("\n");
  if (changes.length > MAX_TEXT_CHARS / 3)
    return `${label}\n${await pageView(now)}`;
  return `${header}\nNew on the page${gone ? ` (${gone} lines left)` : ""}:\n${changes}`;
}

async function snapshotLines(page) {
  return { url: page.url(), lines: (await snapshotText(page)).split("\n") };
}

async function settle(page) {
  await page
    .waitForLoadState("domcontentloaded", { timeout: 5_000 })
    .catch(() => {});
}

// ---- ops ----

const targetName = ({ ref, role, name }) =>
  ref || (name ? `${role} "${name}"` : role);

// ---- consequences: a control that pays or deletes runs only through browser_pay / browser_delete ----

const CONSEQUENCES = [
  [
    "pay",
    /\b(pay|payment|purchase|buy|checkout|check out|place (?:your |the )?order|complete (?:your |the )?order|confirm (?:order|purchase|payment)|subscribe|upgrade|donate|send money|transfer)\b/i,
  ],
  [
    "delete",
    /\b(delete|remove|erase|destroy|discard|deactivate|terminate|revoke|wipe|purge|trash|close (?:my |your |this )?account)\b/i,
  ],
];

function consequenceOf(text) {
  for (const [kind, words] of CONSEQUENCES) if (words.test(text)) return kind;
  return null;
}

// What a person reads on the control, or on the submit buttons of its form when Enter submits it.
function controlText(locator, { submit = false } = {}) {
  return locator.evaluate((el, submit) => {
    const label = (e) =>
      [
        e.getAttribute("aria-label"),
        e.title,
        e.innerText,
        e.tagName === "INPUT" && /^(submit|button)$/.test(e.type)
          ? e.value
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    if (!submit) return label(el);
    const form = el.form || el.closest("form");
    if (!form) return "";
    return [
      ...form.querySelectorAll(
        'button:not([type]), button[type="submit"], input[type="submit"]',
      ),
    ]
      .map(label)
      .join(" ");
  }, submit);
}

// The model names the tool, but the control decides: a pay or delete control needs its approved tool.
async function requireIntent(locator, intent, options) {
  const kind = consequenceOf(await controlText(locator, options));
  if (kind && kind !== intent)
    throw fail("needs_approval", kind, { submit: Boolean(options?.submit) });
}

const OPS = {
  async navigate(page, { url }) {
    if (url === "back")
      await page.goBack({ timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
    else if (url === "forward")
      await page.goForward({ timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
    else {
      let target = String(url || "").trim();
      if (!target) throw fail("invalid_arguments", "url is required");
      if (!/^[a-z]+:/i.test(target)) target = `https://${target}`;
      if (!navigationAllowed(target)) throw fail("site_not_allowed", target);
      try {
        const response = await page.goto(target, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
        if (response && response.headers()[BLOCKED_HEADER])
          throw fail("site_not_allowed", target);
      } catch (e) {
        if (e.code) throw e;
        if (
          /ERR_BLOCKED_BY_CLIENT|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY/.test(
            e.message,
          )
        )
          throw fail("site_not_allowed", target);
        if (/Timeout .*exceeded/.test(e.message)) {
          // A slow page that already opened is still a result: return what has loaded.
          if (page.url() !== "about:blank" && navigationAllowed(page.url()))
            return `[The page did not finish loading in ${NAVIGATION_TIMEOUT_MS / 1000} s. This is what has loaded.]\n${await pageView(page)}`;
          throw fail("page_timeout", target);
        }
        // The site moved on by itself (a script redirect): fine when the page it landed on is allowed.
        if (
          !/interrupted by another navigation/.test(e.message) ||
          !navigationAllowed(page.url())
        )
          throw e;
      }
    }
    await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => {});
    return pageView(page);
  },
  async read_page(page, { filter, ref }) {
    const raw = ref
      ? await (
          await resolveRef(page, ref)
        ).ariaSnapshot({ mode: "ai", timeout: ACTION_TIMEOUT_MS })
      : await snapshotText(page);
    const text =
      filter === "interactive"
        ? raw
            .split("\n")
            .filter(
              (line) =>
                INTERACTIVE_ROLES.test(line) || /\[cursor=pointer\]/.test(line),
            )
            .join("\n")
        : raw;
    const header = await pageHeader(page);
    if (text.length <= MAX_TEXT_CHARS) return `${header}\n${text}`;
    return `${header}\n${outline(raw.split("\n"), text.length)}`;
  },
  async find(page, { query }) {
    const needle = String(query || "")
      .trim()
      .toLowerCase();
    if (!needle) throw fail("invalid_arguments", "query is required");
    const lines = (await snapshotText(page)).split("\n");
    const starts = new Set();
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(needle))
        starts.add(enclosingItem(lines, i));
    });
    const blocks = [...starts]
      .slice(0, MAX_FIND_MATCHES)
      .map((i) => itemBlock(lines, i));
    return capped(
      `${await pageHeader(page)}\n${blocks.length ? blocks.join("\n---\n") : `No element matches "${query}".`}` +
        (starts.size > MAX_FIND_MATCHES
          ? `\n[${starts.size - MAX_FIND_MATCHES} more matches; use a longer query.]`
          : ""),
    );
  },
  async click(page, args) {
    const locator = await resolveTarget(page, args);
    await requireIntent(locator, args.intent);
    const before = await snapshotLines(page);
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    await settle(page);
    return changesSince(page, before, `Clicked ${targetName(args)}.`, {
      mayNavigate: true,
    });
  },
  async type(page, args) {
    const { text, submit } = args;
    // Keys that submit or move focus would act past the pay and delete check; `submit` presses Enter.
    if (/[\r\n\t]/.test(String(text ?? "")))
      throw fail("invalid_arguments", "Text cannot hold Enter or Tab; use submit.");
    const locator = await resolveTarget(page, args);
    // Typing clicks the target first: only a field may be typed into.
    const editable = await locator
      .isEditable({ timeout: ACTION_TIMEOUT_MS })
      .catch(() => false);
    if (!editable)
      throw fail("invalid_arguments", "That element is not a text field.");
    if (submit) await requireIntent(locator, null, { submit: true });
    const before = await snapshotLines(page);
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    // Type over the selection, as a person does: clearing first re-renders some inputs and the keys go astray.
    await locator.press("ControlOrMeta+a", { timeout: ACTION_TIMEOUT_MS });
    await locator.pressSequentially(String(text ?? ""), {
      delay: 15,
      timeout: ACTION_TIMEOUT_MS * 3,
    });
    if (submit) {
      await locator.press("Enter", { timeout: ACTION_TIMEOUT_MS });
      await settle(page);
    }
    await page.waitForTimeout(300);
    return changesSince(
      page,
      before,
      `Typed into ${targetName(args)}${submit ? " and pressed Enter" : ""}.`,
      {
        mayNavigate: Boolean(submit),
      },
    );
  },
  async form_input(page, args) {
    const { value } = args;
    const locator = await resolveTarget(page, args);
    const before = await snapshotLines(page);
    const kind = await locator.evaluate((el) =>
      el.tagName === "SELECT"
        ? "select"
        : el.type === "checkbox" || el.type === "radio"
          ? "check"
          : "fill",
    );
    if (kind === "select")
      await locator.selectOption(String(value), { timeout: ACTION_TIMEOUT_MS });
    else if (kind === "check")
      await locator.setChecked(value === true || value === "true", {
        timeout: ACTION_TIMEOUT_MS,
      });
    else
      await locator.fill(String(value ?? ""), { timeout: ACTION_TIMEOUT_MS });
    return changesSince(page, before, `Set ${targetName(args)}.`);
  },
};

function opError(e) {
  if (e.code === "needs_approval") {
    const tool = e.message === "pay" ? "browser_pay" : "browser_delete";
    const what = e.message === "pay" ? "pays or orders" : "deletes or removes";
    return agentError(
      "needs_approval",
      `That ${e.submit ? "form" : "control"} ${what} something. Nothing was done.`,
      {
        next_step: e.submit
          ? `Type without submit, then use ${tool} on the form's button.`
          : `Use ${tool} on it with a summary; the person approves first.`,
      },
    );
  }
  if (e.code === "site_not_allowed") {
    return agentError(
      "site_not_allowed",
      `No browser login allows ${e.message}.`,
      { next_step: "This site is not on any of the person's browser logins." },
    );
  }
  if (e.code === "page_timeout") {
    return agentError(
      "page_timeout",
      `${e.message} did not start loading in ${NAVIGATION_TIMEOUT_MS / 1000} s.`,
      {
        retryable: true,
        next_step:
          "Try browser_navigate again once; if it fails again, tell the person the site is not responding.",
      },
    );
  }
  if (e.code === "ambiguous_target") {
    return agentError(
      "ambiguous_target",
      `${e.count} elements match. Nothing was done. They are:\n${e.message}`,
      {
        next_step:
          "Act again with the ref of the one you mean, or a more exact name.",
      },
    );
  }
  if (e.code === "element_not_found" && e.count === 0) {
    return agentError(
      "element_not_found",
      e.message
        ? `No element has that role and name. Nothing was done. Elements with that role:\n${e.message}`
        : "No element has that role and name. Nothing was done.",
      {
        next_step:
          "Act again with a ref or a name from this list, or read the page.",
      },
    );
  }
  if (
    e.code === "element_not_found" ||
    /Timeout .*exceeded|not attached|No node found|aria-ref/i.test(
      e.message || "",
    )
  ) {
    return agentError(
      "element_not_found",
      "That element is not on the page any more, or it cannot be used.",
      {
        next_step:
          "Call browser_read_page again and use a ref from the new result.",
      },
    );
  }
  if (e.code === "invalid_arguments") {
    return agentError("invalid_arguments", e.message, {
      next_step: "Pass an element ref from browser_read_page, such as e12.",
    });
  }
  return agentError(
    "browser_error",
    String(e.message || e)
      .split("\n")[0]
      .slice(0, 300),
    {
      next_step:
        "Call browser_read_page to see the current page, then try a different action.",
    },
  );
}

// True when the API expects another set of logins than the browser loaded (`loadedGenerations`).
function loginsChanged(expected, loadedGenerations) {
  if (
    !Array.isArray(expected) ||
    !loadedGenerations ||
    typeof loadedGenerations !== "object"
  )
    return false;
  const loaded = Object.keys(loadedGenerations);
  return (
    loaded.length !== expected.length ||
    expected.some((id) => !loaded.includes(String(id)))
  );
}

async function runOp(op, args, logins) {
  if (!context)
    return agentError("not_setup", "The browser is not set up yet.");
  if (loginsChanged(logins, generation))
    return agentError(
      "logins_changed",
      "This browser holds other logins than the run may use.",
    );
  if (control === "user") {
    return agentError(
      "user_in_control",
      "A person is controlling the browser.",
      {
        next_step:
          'Call browser_wait_for_user with reason "other" and wait until they give control back.',
      },
    );
  }
  const handler = OPS[op];
  if (!handler) return agentError("invalid_arguments", `Unknown op ${op}.`);
  try {
    const page = await currentPage();
    const text = await handler(page, args || {});
    // A page that moved off the list during the op is never read back to the model.
    if (!documentAllowed(page.url()))
      throw fail("site_not_allowed", new URL(page.url()).hostname);
    lastCookieHash = await cookieHash();
    // Reopens a page if the op closed the last one, so the live view always has one.
    await currentPage();
    return {
      ok: true,
      text,
      stateDirty: lastCookieHash !== exportedCookieHash,
    };
  } catch (e) {
    return opError(e);
  }
}

// ---- live view ----

function send(ws, message) {
  if (ws.readyState === 1) ws.send(JSON.stringify(message));
}

function broadcast(message) {
  const text = JSON.stringify(message);
  viewers.forEach((ws) => ws.readyState === 1 && ws.send(text));
}

async function statusMessage() {
  const page = activePage && !activePage.isClosed() ? activePage : null;
  return {
    type: "status",
    control,
    url: page ? page.url() : "",
    title: page ? await page.title().catch(() => "") : "",
  };
}

function broadcastStatus() {
  if (!viewers.size) return;
  statusMessage()
    .then(broadcast)
    .catch(() => {});
}

async function stopScreencast() {
  const current = screencast;
  screencast = null;
  if (!current) return;
  await current.session.send("Page.stopScreencast").catch(() => {});
  await current.session.detach().catch(() => {});
}

async function restartScreencast() {
  await stopScreencast();
  const page = activePage;
  if (!page || page.isClosed() || !viewers.size) return;
  const session = await context.newCDPSession(page);
  screencast = { session, page };
  session.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    broadcast({
      type: "frame",
      data,
      width: metadata.deviceWidth,
      height: metadata.deviceHeight,
    });
  });
  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality: 60,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
  });
  // Chrome sends no screencast frame for a page that is not repainting, so a new viewer gets one explicitly.
  const still = await page
    .screenshot({ type: "jpeg", quality: 60 })
    .catch(() => null);
  if (still && screencast && screencast.page === page) {
    broadcast({
      type: "frame",
      data: still.toString("base64"),
      width: VIEWPORT.width,
      height: VIEWPORT.height,
    });
  }
}

function setControl(next) {
  if (control === next) return;
  control = next;
  broadcastStatus();
}

const MOUSE_BUTTONS = new Set(["left", "middle", "right"]);
let inputChain = Promise.resolve();

async function applyInput(message) {
  const page = activePage;
  if (!page || page.isClosed()) return;
  switch (message.type) {
    case "control":
      setControl(message.take ? "user" : "agent");
      return;
    case "mouse": {
      setControl("user");
      const x = Number(message.x) || 0;
      const y = Number(message.y) || 0;
      const button = MOUSE_BUTTONS.has(message.button)
        ? message.button
        : "left";
      if (message.event === "move") await page.mouse.move(x, y);
      else if (message.event === "down") {
        await page.mouse.move(x, y);
        await page.mouse.down({ button });
      } else if (message.event === "up") {
        await page.mouse.move(x, y);
        await page.mouse.up({ button });
      } else if (message.event === "wheel") {
        await page.mouse.move(x, y);
        await page.mouse.wheel(
          Number(message.deltaX) || 0,
          Number(message.deltaY) || 0,
        );
      }
      return;
    }
    case "key":
      setControl("user");
      if (message.event === "down")
        await page.keyboard.down(String(message.key));
      else if (message.event === "up")
        await page.keyboard.up(String(message.key));
      return;
    case "text":
      setControl("user");
      // Real key presses, not bare inserted text: some forms (x.com) validate only on key events.
      await page.keyboard.type(String(message.text || ""));
      return;
    case "reload":
      setControl("user");
      await page.reload({
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      return;
    case "navigate": {
      setControl("user");
      let target = String(message.url || "").trim();
      if (!/^[a-z]+:/i.test(target)) target = `https://${target}`;
      if (navigationAllowed(target))
        await page.goto(target, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
      return;
    }
  }
}

function attachViewer(ws) {
  viewers.add(ws);
  statusMessage()
    .then((m) => send(ws, m))
    .catch(() => {});
  if (viewers.size === 1) restartScreencast().catch(() => {});
  ws.on("message", (raw) => {
    lastActivity = Date.now();
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    // One at a time, in arrival order: overlapping key presses would scramble typed text.
    inputChain = inputChain.then(() => applyInput(message)).catch(() => {});
  });
  ws.on("close", () => {
    viewers.delete(ws);
    if (!viewers.size) {
      setControl("agent");
      stopScreencast().catch(() => {});
    }
  });
}

// ---- http ----

let lastActivity = Date.now();

function authorized(req) {
  if (!ACCESS_TOKEN) return false;
  const given = Buffer.from(
    String(req.headers["x-agenta-browser-token"] || ""),
  );
  const expected = Buffer.from(ACCESS_TOKEN);
  return (
    given.length === expected.length && crypto.timingSafeEqual(given, expected)
  );
}

function exitWhenIdle() {
  setInterval(() => {
    if (viewers.size || Date.now() - lastActivity < IDLE_EXIT_MS) return;
    browser
      .close()
      .catch(() => {})
      .finally(() => process.exit(0));
  }, 30_000).unref();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(
          chunks.length
            ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
            : {},
        );
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function reply(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function route(req, res) {
  if (!authorized(req)) return reply(res, 401, { ok: false });
  lastActivity = Date.now();
  const path = new URL(req.url, "http://controller").pathname;
  if (req.method === "GET" && path === "/health")
    return reply(res, 200, { ok: true });
  if (req.method === "POST" && path === "/setup") {
    const body = await readJson(req);
    if (!setupPromise) {
      setupPromise = setup(body).catch((e) => {
        setupPromise = null;
        throw e;
      });
    }
    await setupPromise;
    return reply(res, 200, { ok: true });
  }
  if (req.method === "POST" && path === "/op") {
    const body = await readJson(req);
    return reply(
      res,
      200,
      await runOp(String(body.op || ""), body.args, body.logins),
    );
  }
  if (req.method === "GET" && path === "/state") {
    if (!context)
      return reply(
        res,
        409,
        agentError("not_setup", "The browser is not set up yet."),
      );
    const storageState = await context.storageState();
    exportedCookieHash = await cookieHash();
    return reply(res, 200, { storageState, generation });
  }
  return reply(res, 404, { ok: false });
}

async function main() {
  if (!ACCESS_TOKEN) throw new Error("AGENTA_BROWSER_TOKEN is not set");
  // Run by the runner as a child (the local provider): leave with it, and report the chosen port.
  if (process.send) process.on("disconnect", () => process.exit(0));
  await launch(await startProxy());
  const server = http.createServer((req, res) => {
    route(req, res).catch((e) =>
      reply(
        res,
        500,
        agentError("browser_error", String(e.message || e).slice(0, 300)),
      ),
    );
  });
  const {
    wsServer: WebSocketServer,
  } = require("playwright-core/lib/utilsBundle");
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (
      new URL(req.url, "http://controller").pathname !== "/live" ||
      !context ||
      !authorized(req)
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, attachViewer);
  });
  server.listen(PORT, "0.0.0.0", () => {
    if (process.send) process.send({ port: server.address().port });
  });
  if (IDLE_EXIT_MS > 0) exitWhenIdle();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  OPS,
  consequenceOf,
  documentAllowed,
  ipBlocked,
  loginsChanged,
  outline,
  enclosingItem,
  itemBlock,
  lineChanges,
  resolveTarget,
};
