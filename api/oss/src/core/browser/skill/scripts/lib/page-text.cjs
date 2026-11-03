"use strict";

// The page as text for the model: the aria snapshot whole, an outline of a long page, the
// matches of a search, or only what an action changed.

const { MAX_TEXT_CHARS } = require("./config.cjs");

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
    const name = line.includes('"') ? "" : preview(lines, i);
    return `${line}${name ? ` ${name}` : ""} (${size.toLocaleString("en-US")} chars${items})`;
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
  if (page.isClosed())
    return `${label}\nThat tab closed. Run \`agenta-browser tab\` to see the open tabs.`;
  if (page.url() !== before.url) return `${label}\n${await pageView(page)}`;
  const { lines: out, gone } = lineChanges(
    before.lines,
    (await snapshotText(page)).split("\n"),
  );
  const header = `${label} ${await pageHeader(page)}`;
  if (!out.length)
    return gone
      ? `${header}\n${gone} lines left the page; nothing new appeared.`
      : `${header}\nNo change on the page.`;
  const changes = out.join("\n");
  if (changes.length > MAX_TEXT_CHARS / 3)
    return `${label}\n${await pageView(page)}`;
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

module.exports = {
  INTERACTIVE_ROLES,
  capped,
  changesSince,
  enclosingItem,
  itemBlock,
  lineChanges,
  outline,
  pageHeader,
  pageView,
  settle,
  snapshotLines,
  snapshotText,
};
