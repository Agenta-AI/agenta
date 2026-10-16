#!/usr/bin/env node
// agenta-browser: one Chromium that an agent drives from its shell, inside its own session sandbox.
// `agenta-browser <command>` starts the browser on first use and keeps it running between commands.
// The same process serves the live view, so a person can watch the page and take control.
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const PORT = Number(process.env.AGENTA_BROWSER_PORT || 8790);
const RUN_DIR = process.env.AGENTA_BROWSER_DIR || "/tmp/agenta-browser";
const TOKEN_FILE = path.join(RUN_DIR, "token");
// Saved logins (cookies and site storage). The agent's folder keeps them across sessions.
const STATE_FILE = path.resolve(
  process.env.AGENTA_BROWSER_STATE ||
    (fs.existsSync("agent-files") ? "agent-files/.browser/state.json" : ".browser/state.json"),
);
const VIEWPORT = { width: 1280, height: 800 };
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TEXT_CHARS = 30_000;
const ACTION_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
// A wait ends before the runner's 30-minute tool-call limit, so the agent always gets an answer.
const MAX_WAIT_MS = 25 * 60_000;

let browser;
let context;
let activePage;
let control = "agent";
let lastStateHash = "";
const viewers = new Set();
let screencast = null;
let accessToken = "";
let lastActivity = Date.now();

const fail = (code, message, extra) =>
  Object.assign(new Error(message), { code, ...extra });

function agentError(code, message, { next_step } = {}) {
  return { ok: false, error: { code, message, ...(next_step ? { next_step } : {}) } };
}

// ---- browser ----

function navigationAllowed(rawUrl) {
  if (rawUrl === "about:blank") return true;
  try {
    return ["http:", "https:"].includes(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname || rawUrl;
  } catch {
    return rawUrl;
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return undefined;
  }
}

const hashOf = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Saves only when the cookies or site storage changed, so a read never rewrites the file.
async function saveState() {
  const state = await context.storageState();
  const hash = hashOf(state);
  if (hash === lastStateHash) return false;
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE);
  lastStateHash = hash;
  return true;
}

async function launch() {
  const { chromium } = require("playwright-core");
  browser = await chromium.launch({
    headless: true,
    // The full Chromium build, not the headless shell: sites such as x.com refuse the shell with 403.
    channel: "chromium",
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
  });
  browser.on("disconnected", () => process.exit(1));
  const saved = readState();
  context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
    locale: "en-US",
    acceptDownloads: false,
    ...(saved ? { storageState: saved } : {}),
  });
  context.on("page", (page) => {
    trackPage(page);
    setActivePage(page);
  });
  lastStateHash = hashOf(await context.storageState());
  setActivePage(await context.newPage());
}

function trackPage(page) {
  page.on("close", () => {
    if (page !== activePage) return;
    const open = context.pages();
    setActivePage(open.length ? open[open.length - 1] : null);
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && page === activePage) broadcastStatus();
  });
}

function setActivePage(page) {
  activePage = page;
  broadcastStatus();
  if (viewers.size) restartScreencast().catch(() => {});
}

async function currentPage() {
  if (!activePage || activePage.isClosed()) setActivePage(await context.newPage());
  return activePage;
}

// ---- page text (from the cloud-browser controller in PR #7562) ----

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
    "\n\n[Cut: the page is larger than the result limit. Run `agenta-browser read <ref>` for the part you need, or `agenta-browser find <word>`.]"
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
    `agenta-browser read <ref>, or act on a control by its role and name.]\n${rows.join("\n")}`
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

// ---- consequences: a control that pays or deletes runs only with --intent pay or --intent delete ----

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

// The control a click on this element activates: itself, or the button or link it sits in.
const ACTIONABLE =
  "xpath=ancestor-or-self::*[self::button or self::a or self::summary or @role='button' or @role='link' or @role='menuitem' or @role='menuitemcheckbox' or @role='menuitemradio' or @role='option' or @role='tab' or @role='switch' or (self::input and (@type='submit' or @type='button' or @type='image'))][1]";
const SUBMIT_BUTTONS =
  'button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]';

// The control's role, accessible name and named children, as in the model's page view (alt, SVG
// title and aria-labelledby included): a link can carry its name only on an image inside it.
function labelOf(locator) {
  return locator.ariaSnapshot({ timeout: ACTION_TIMEOUT_MS });
}

// What a person reads on the control, or on the submit buttons of its form when Enter submits it.
async function controlText(locator, { submit = false } = {}) {
  if (submit) {
    const buttons = locator
      .locator("xpath=ancestor::form[1]")
      .locator(SUBMIT_BUTTONS);
    const names = [];
    for (let i = 0; i < (await buttons.count()); i++)
      names.push(await labelOf(buttons.nth(i)));
    return names.join(" ");
  }
  const control = locator.locator(ACTIONABLE);
  return labelOf((await control.count()) ? control.first() : locator);
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
      throw fail(
        "invalid_arguments",
        "Text cannot hold Enter or Tab; use submit.",
      );
    const locator = await resolveTarget(page, args);
    // Typing clicks the target first: only a field may be typed into.
    const editable = await locator
      .isEditable({ timeout: ACTION_TIMEOUT_MS })
      .catch(() => false);
    if (!editable)
      throw fail("invalid_arguments", "That element is not a text field.");
    if (submit) await requireIntent(locator, args.intent, { submit: true });
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

// ---- live view (from the cloud-browser controller in PR #7562) ----


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
    waiting: waitingReason,
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
  const previous = control;
  control = next;
  broadcastStatus();
  controlChanged(previous, next);
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
      // The viewer typed this address: say why it did not open, so the bar is never left lying.
      if (!navigationAllowed(target)) {
        broadcast({
          type: "notice",
          message: `${hostOf(target)} cannot be opened.`,
        });
        return;
      }
      await page
        .goto(target, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        })
        .catch(() =>
          broadcast({
            type: "notice",
            message: `${hostOf(target)} did not load.`,
          }),
        );
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

// ---- ops ----

const BLOCKED_HEADER = "x-agenta-blocked";

function opError(e) {
  if (e.code === "needs_approval") {
    const what = e.message === "pay" ? "pays or orders" : "deletes or removes";
    return agentError(
      "needs_approval",
      `That ${e.submit ? "form" : "control"} ${what} something. Nothing was done.`,
      {
        next_step: `Ask the person first. Only after they say yes, run the same command again with --intent ${e.message}.`,
      },
    );
  }
  if (e.code === "site_not_allowed")
    return agentError("site_not_allowed", `${e.message} cannot be opened.`);
  if (e.code === "page_timeout")
    return agentError("page_timeout", `${e.message} did not start loading in ${NAVIGATION_TIMEOUT_MS / 1000} s.`, {
      next_step: "Try once more; if it fails again, tell the person the site is not responding.",
    });
  if (e.code === "ambiguous_target")
    return agentError("ambiguous_target", `${e.count} elements match. Nothing was done. They are:\n${e.message}`, {
      next_step: "Run the command again with the ref of the one you mean.",
    });
  if (e.code === "element_not_found" && e.count === 0)
    return agentError("element_not_found", `No element has that role and name. Nothing was done.${e.message ? ` Elements with that role:\n${e.message}` : ""}`, {
      next_step: "Use a ref from `agenta-browser read`.",
    });
  if (e.code === "element_not_found" || /Timeout .*exceeded|not attached|No node found|aria-ref/i.test(e.message || ""))
    return agentError("element_not_found", "That element is not on the page any more, or it cannot be used.", {
      next_step: "Run `agenta-browser read` again and use a ref from the new result.",
    });
  if (e.code === "invalid_arguments") return agentError("invalid_arguments", e.message);
  return agentError("browser_error", String(e.message || e).split("\n")[0].slice(0, 300));
}

async function runOp(op, args) {
  if (control === "user")
    return agentError("user_in_control", "A person is controlling the browser.", {
      next_step: 'Run `agenta-browser wait "<why>"` and continue when it returns.',
    });
  const handler = OPS[op];
  if (!handler) return agentError("invalid_arguments", `Unknown command ${op}.`);
  try {
    const page = await currentPage();
    const text = await handler(page, args || {});
    await saveState().catch(() => {});
    return { ok: true, text };
  } catch (e) {
    return opError(e);
  }
}

// ---- waiting for the person ----

let waitingReason = "";
let waiters = [];

// Ends a wait when the person gives control back: "I'm done", or closing the live view.
function controlChanged(previous, next) {
  if (previous === "user" && next === "agent") {
    const done = waiters;
    waiters = [];
    done.forEach((resolve) => resolve("done"));
  }
}

async function waitForPerson(reason, timeoutMs) {
  waitingReason = String(reason || "The agent needs your help in the browser.").slice(0, 300);
  broadcastStatus();
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    waiters.push((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  waitingReason = "";
  broadcastStatus();
  if (outcome === "timeout")
    return agentError("wait_timeout", "Nobody gave the browser back in time.", {
      next_step: "Tell the person what you need and stop. They can reply when they are ready.",
    });
  await saveState().catch(() => {});
  return { ok: true, text: `The person gave the browser back.\n${await pageView(await currentPage())}` };
}

// ---- server ----

function authorized(req) {
  const given = Buffer.from(String(req.headers["x-agenta-browser-token"] || ""));
  const expected = Buffer.from(accessToken);
  return accessToken && given.length === expected.length && crypto.timingSafeEqual(given, expected);
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

// One command at a time: parallel commands would interleave on the one page.
let opChain = Promise.resolve();
function serially(work) {
  const run = opChain.then(work);
  opChain = run.catch(() => {});
  return run;
}

async function route(req, res) {
  if (!authorized(req)) return reply(res, 401, { ok: false });
  const url = new URL(req.url, "http://browser");
  if (req.method === "GET" && url.pathname === "/health") return reply(res, 200, { ok: true });
  if (req.method !== "POST") return reply(res, 404, { ok: false });
  const body = await readJson(req);
  if (url.pathname === "/op")
    return reply(res, 200, await serially(() => runOp(String(body.op || ""), body.args)));
  if (url.pathname === "/wait")
    return reply(res, 200, await waitForPerson(body.reason, Math.min(Number(body.timeoutMs) || MAX_WAIT_MS, MAX_WAIT_MS)));
  if (url.pathname === "/save")
    return reply(res, 200, { ok: true, text: (await serially(saveState)) ? `Saved to ${STATE_FILE}.` : "Nothing changed." });
  if (url.pathname === "/stop") {
    await serially(saveState).catch(() => {});
    reply(res, 200, { ok: true, text: "Stopped." });
    return browser.close().finally(() => process.exit(0));
  }
  return reply(res, 404, { ok: false });
}

async function serve() {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
  accessToken = crypto.randomBytes(32).toString("hex");
  await launch();
  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => reply(res, 500, agentError("browser_error", String(e.message || e).slice(0, 300))));
  });
  const { wsServer: WebSocketServer } = require("playwright-core/lib/utilsBundle");
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://browser").pathname !== "/live" || !authorized(req)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, attachViewer);
  });
  // All interfaces: the live view reaches this port through the sandbox's preview link.
  await new Promise((resolve) => server.listen(PORT, "0.0.0.0", resolve));
  // Written last: a token file means the browser is ready.
  fs.writeFileSync(TOKEN_FILE, accessToken, { mode: 0o600 });
  // Only our own token: a new browser may already have written its file.
  const cleanup = () => {
    try {
      if (fs.readFileSync(TOKEN_FILE, "utf8") === accessToken) fs.rmSync(TOKEN_FILE, { force: true });
    } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGTERM", () => process.exit(0));
}

// ---- command line ----

const USAGE = `agenta-browser: drive one Chromium that keeps running between commands.

  open <url>                     open a page (also: open back, open forward)
  read [ref] [--interactive]     read the page, or one part of it by ref
  find <text>                    find text on the page, with its list item or row
  click <ref>                    click (or: click --role button --name "Save")
  type <ref> <text> [--submit]   replace a field's text; --submit presses Enter
  set <ref> <value>              choose an option, tick a box, or fill a field
  wait "<reason>"                hand the browser to the person; returns when they are done
  save                           save the cookies now (also saved after each command)
  stop                           close the browser

Pay and delete controls are refused until you add --intent pay or --intent delete.
Only add it after the person said yes.`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) positional.push(a);
    else if (["--submit", "--interactive"].includes(a)) flags[a.slice(2)] = true;
    else flags[a.slice(2)] = argv[++i];
  }
  return { positional, flags };
}

// The command line's op and arguments, in the shape the PR's ops take.
function request(command, { positional: p, flags: f }) {
  const target = { ref: f.role ? undefined : p[0], role: f.role, name: f.name };
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
      return ["/op", { op: "type", args: { ...target, text: f.role ? p.join(" ") : p.slice(1).join(" "), submit: f.submit, intent: f.intent } }];
    case "set":
      return ["/op", { op: "form_input", args: { ...target, value: f.role ? p.join(" ") : p.slice(1).join(" ") } }];
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

function call(pathname, body, timeoutMs = 60_000) {
  const token = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, "utf8") : "";
  return fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-agenta-browser-token": token },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  }).then((r) => r.json());
}

const running = () => call("/health", null, 3_000).then((r) => r.ok === true, () => false);

// Playwright is installed globally in the sandbox image; its playwright-core sits inside it.
function nodePath() {
  const root = path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules");
  return [process.env.NODE_PATH, root, path.join(root, "playwright", "node_modules")].filter(Boolean).join(path.delimiter);
}

async function ensureRunning() {
  if (await running()) return;
  fs.rmSync(TOKEN_FILE, { force: true });
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(RUN_DIR, "browser.log"), "a");
  // Detached: its own session and process group, so a command time limit never kills the browser.
  spawn(process.execPath, [__filename, "serve"], {
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, NODE_PATH: nodePath(), AGENTA_BROWSER_STATE: STATE_FILE },
  }).unref();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(TOKEN_FILE) && (await running())) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`The browser did not start. See ${path.join(RUN_DIR, "browser.log")}.`);
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "serve") return serve();
  const req = command && request(command, parseArgs(rest));
  if (!req) {
    console.log(USAGE);
    process.exit(command ? 2 : 0);
  }
  if (command === "stop" && !(await running())) return console.log("The browser is not running.");
  await ensureRunning();
  const result = await call(req[0], req[1], command === "wait" ? MAX_WAIT_MS + 60_000 : 120_000);
  // Return only when the browser is gone, so the next command starts a fresh one.
  if (command === "stop") while (await running()) await new Promise((r) => setTimeout(r, 200));
  if (result.ok) return console.log(result.text);
  const { code, message, next_step } = result.error || {};
  console.log(`Error (${code}): ${message}${next_step ? `\nNext: ${next_step}` : ""}`);
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e.message || e));
    process.exit(1);
  });
}

module.exports = { OPS, consequenceOf, outline, lineChanges, request, parseArgs };
