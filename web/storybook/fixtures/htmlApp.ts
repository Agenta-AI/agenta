import {
    createMockHtmlAppHost,
    type AssembleIo,
    type MockHtmlAppHost,
    type MockHtmlAppHostOptions,
} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"

/**
 * Fixtures for the agent HTML app stories (`@agenta/entity-ui/Drive/HtmlApp/*`).
 *
 * Three apps, each a `path → text` map the mock host is seeded with (paths are relative to the
 * app dir, like the mock expects):
 *
 * - `BOARD_APP` — a retro board written against the kit classes (`.ag-app`, `.ag-toolbar`,
 *   `.ag-columns`, `.ag-card`, …) with an `app.json` asking for read-write and a `board.json`.
 *   It awaits `agenta.ready` and reads `board.json`; a failed read shows in its own `.ag-empty`
 *   state instead of dying.
 * - `SITE` — two pages sharing `app.js` and `site.css`; `index.html` links `guide.html`, which is
 *   what the Run tab's back stack is for.
 * - `BROKEN_APP` — throws on load and references a CDN script the sandbox drops.
 *
 * `createStoryHost` is the mock seeded in the story app dir; its `emitNav` / `emitError` raise what
 * only the iframe normally sends over the port. `fixtureIo` serves the host's live `files` map to
 * the assembler, so an `externalWrite` shows up on "Reload files".
 */

export const STORY_MOUNT: Mount = {id: "mount-story", name: "agent drive", slug: "agent-drive"}

/** App dir (mount-relative) the stories use for every fixture. */
export const APP_DIR = "agent-files/apps/board"
export const SITE_DIR = "agent-files/site"

const BOARD_CSS = `
.board-note{margin:0 0 8px;color:var(--ag-muted)}
.ag-card h4{margin:0 0 4px;font-size:12px}
.ag-card p{margin:0;color:var(--ag-muted)}
`

const BOARD_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Retro board</title>
<link rel="stylesheet" href="board.css">
</head>
<body class="ag-app">
<header class="ag-toolbar">
  <strong>Retro board</strong>
  <span class="ag-badge" id="status">starting…</span>
  <button class="ag-btn ag-btn-primary" id="add" disabled>Add card</button>
</header>
<p class="board-note" id="note"></p>
<main class="ag-columns" id="columns">
  <div class="ag-empty" id="empty">Loading board.json…</div>
</main>
<script>
(async function () {
  var status = document.getElementById("status");
  var empty = document.getElementById("empty");
  var columns = document.getElementById("columns");
  var note = document.getElementById("note");
  function render(board) {
    columns.innerHTML = "";
    (board.columns || []).forEach(function (col) {
      var el = document.createElement("section");
      el.className = "ag-column";
      var h = document.createElement("h3");
      h.textContent = col.title;
      el.appendChild(h);
      var list = document.createElement("div");
      list.className = "ag-list";
      (board.cards || []).filter(function (c) { return c.column === col.id }).forEach(function (c) {
        var card = document.createElement("article");
        card.className = "ag-card";
        card.innerHTML = "<h4></h4><p></p>";
        card.querySelector("h4").textContent = c.title;
        card.querySelector("p").textContent = c.body || "";
        list.appendChild(card);
      });
      el.appendChild(list);
      columns.appendChild(el);
    });
    if (!columns.children.length) {
      columns.innerHTML = '<div class="ag-empty">The board is empty. Add a card.</div>';
    }
  }
  try {
    await window.agenta.ready;
    var board = await window.agenta.fs.readJSON("board.json");
    render(board);
    status.textContent = window.agenta.canWrite ? "read + write" : "read-only";
    document.getElementById("add").disabled = !window.agenta.canWrite;
    window.agenta.addEventListener("changed", async function () {
      note.textContent = "board.json changed outside the app — reloaded.";
      render(await window.agenta.fs.readJSON("board.json"));
    });
  } catch (e) {
    status.textContent = e && e.code ? e.code : "error";
    empty.textContent =
      e && e.code === "not_found"
        ? "No board.json yet — ask the agent to create one."
        : "Bridge unavailable: " + (e && e.message ? e.message : e);
  }
})();
</script>
</body>
</html>`

export const BOARD_MANIFEST = {
    agenta_app: 1,
    name: "Retro board",
    icon: "📋",
    entry: "index.html",
    template: "board@1",
    access: "read-write",
    data: ["board.json"],
    kit: true,
}

export const BOARD_DATA = {
    columns: [
        {id: "went-well", title: "Went well"},
        {id: "improve", title: "To improve"},
        {id: "actions", title: "Actions"},
    ],
    cards: [
        {id: "c1", column: "went-well", title: "Drive uploads shipped", body: "Two days early."},
        {id: "c2", column: "improve", title: "Flaky VRT", body: "Dark-mode pads read 87%."},
        {id: "c3", column: "actions", title: "Write the parity README", body: "Owner: Arda"},
    ],
}

export const BOARD_APP: Record<string, string> = {
    "index.html": BOARD_HTML,
    "board.css": BOARD_CSS,
    "app.json": JSON.stringify(BOARD_MANIFEST, null, 2),
    "board.json": JSON.stringify(BOARD_DATA, null, 2),
}

/** The board without its data file — the app's own `not_found` empty state. */
export const BOARD_APP_NO_DATA: Record<string, string> = {
    "index.html": BOARD_HTML,
    "board.css": BOARD_CSS,
    "app.json": JSON.stringify(BOARD_MANIFEST, null, 2),
}

/** The board asking only for read access. */
export const BOARD_APP_READ: Record<string, string> = {
    ...BOARD_APP,
    "app.json": JSON.stringify({...BOARD_MANIFEST, access: "read"}, null, 2),
}

const SITE_CSS = `
body{font:12px/1.5 var(--ag-font, system-ui);color:var(--ag-fg,#242424);background:var(--ag-bg,#fff);margin:0;padding:16px}
nav a{margin-right:12px}
footer{margin-top:24px;color:var(--ag-muted,#676770)}
`
const SITE_JS = `document.addEventListener("DOMContentLoaded", function () {
  var f = document.querySelector("footer");
  if (f) f.textContent = "Rendered by app.js on " + document.title;
});`

export const SITE: Record<string, string> = {
    "index.html": `<!doctype html>
<html><head><meta charset="utf-8"><title>Handbook</title>
<link rel="stylesheet" href="site.css"><script src="app.js"></script></head>
<body>
<nav><a href="index.html">Home</a><a href="guide.html">Guide</a><a href="../notes.md">Notes (outside)</a></nav>
<h1>Handbook</h1>
<p>Two pages, one stylesheet, one script. Open the <a href="guide.html">guide</a>.</p>
<footer></footer>
</body></html>`,
    "guide.html": `<!doctype html>
<html><head><meta charset="utf-8"><title>Guide</title>
<link rel="stylesheet" href="site.css"><script src="app.js"></script></head>
<body>
<nav><a href="index.html">Home</a><a href="guide.html">Guide</a></nav>
<h1>Guide</h1>
<p>You navigated inside the app dir — the strip shows "‹ back".</p>
<footer></footer>
</body></html>`,
    "site.css": SITE_CSS,
    "app.js": SITE_JS,
}

export const BROKEN_APP: Record<string, string> = {
    "index.html": `<!doctype html>
<html><head><meta charset="utf-8"><title>Broken</title>
<script src="https://cdn.example.com/chart.min.js"></script>
</head>
<body class="ag-app">
<h1>Broken app</h1>
<p>This page throws on load and wants a CDN script the sandbox blocks.</p>
<script>throw new Error("boom on load")</script>
</body></html>`,
    "app.json": JSON.stringify({agenta_app: 1, name: "Broken app", access: "read"}, null, 2),
}

// ---------------------------------------------------------------------------------------------
// Host + io helpers
// ---------------------------------------------------------------------------------------------

export type StoryHost = MockHtmlAppHost

/** The mock host, seeded in the story app dir. */
export const createStoryHost = (
    files: Record<string, string>,
    opts: MockHtmlAppHostOptions = {},
): StoryHost => createMockHtmlAppHost(files, {dir: APP_DIR, ...opts})

/** Serve the host's live files to the assembler (mount-relative paths → dir-relative keys). */
export function fixtureIo(host: MockHtmlAppHost, dir: string): AssembleIo {
    const key = (path: string) =>
        dir && path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path
    return {
        fetchText: async (path) => host.files.get(key(path)) ?? null,
        fetchDataUri: async () => null,
    }
}
