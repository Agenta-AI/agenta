/**
 * Board starter fixture: the starter files read straight from the API bundle at build time
 * (webpack `?raw` → `asset/source`), plus the two story-only shims a starter needs to run in an
 * iframe before lanes A (bridge stub) and E (kit CSS) land.
 */
import {RUN_CSP} from "@agenta/entities/drive"

import appJson from "../../../api/oss/src/core/apps/starters/board@1/app.json?raw"
import configDefaults from "../../../api/oss/src/core/apps/starters/board@1/config.defaults.json?raw"
import indexHtml from "../../../api/oss/src/core/apps/starters/board@1/index.html?raw"

export const BOARD_STARTER_INDEX_HTML: string = indexHtml
export const BOARD_STARTER_APP_JSON: string = appJson
export const BOARD_STARTER_CONFIG_JSON: string = configDefaults

/** What `create_app("board", dir)` leaves in the folder. */
export const BOARD_STARTER_FILES: Record<string, string> = {
    "index.html": BOARD_STARTER_INDEX_HTML,
    "app.json": BOARD_STARTER_APP_JSON,
    "config.json": BOARD_STARTER_CONFIG_JSON,
}

export const FIVE_CARDS_BOARD = JSON.stringify(
    {
        columns: [
            {
                id: "todo",
                title: "To do",
                cards: [
                    {id: "c1", text: "Write the release notes"},
                    {id: "c2", text: "Ping design about the empty state"},
                ],
            },
            {
                id: "doing",
                title: "Doing",
                cards: [
                    {id: "c3", text: "Wire the conflict path"},
                    {id: "c4", text: "Storybook harness for the board", done: false},
                ],
            },
            {id: "done", title: "Done", cards: [{id: "c5", text: "Manifest parser", done: true}]},
        ],
    },
    null,
    2,
)

/** Kit token sets for the two themes; the host sends one in `hello` and on `theme`. */
export const KIT_TOKENS: Record<"light" | "dark", Record<string, string>> = {
    light: {
        "--ag-bg": "#ffffff",
        "--ag-fg": "#111827",
        "--ag-muted": "#6b7280",
        "--ag-line": "#e5e7eb",
        "--ag-accent": "#4f46e5",
        "--ag-accent-soft": "#eef2ff",
        "--ag-ok": "#16a34a",
        "--ag-warn": "#d97706",
        "--ag-crit": "#dc2626",
        "--ag-font": "system-ui, -apple-system, Segoe UI, sans-serif",
        "--ag-radius": "6px",
    },
    dark: {
        "--ag-bg": "#111827",
        "--ag-fg": "#f3f4f6",
        "--ag-muted": "#9ca3af",
        "--ag-line": "#374151",
        "--ag-accent": "#818cf8",
        "--ag-accent-soft": "#1f2937",
        "--ag-ok": "#4ade80",
        "--ag-warn": "#fbbf24",
        "--ag-crit": "#f87171",
        "--ag-font": "system-ui, -apple-system, Segoe UI, sans-serif",
        "--ag-radius": "6px",
    },
}

// story-only kit CSS; replaced by lane E's kit stylesheet when it lands. Same class names,
// same tokens, no url()/@import/@font-face.
export const STORY_KIT_CSS = `
html,body{margin:0;background:var(--ag-bg);color:var(--ag-fg);font:12px/1.4 var(--ag-font)}
.ag-app{padding:12px;min-height:100vh;box-sizing:border-box}
.ag-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.ag-btn{font:inherit;padding:4px 8px;border:1px solid var(--ag-line);border-radius:var(--ag-radius);background:var(--ag-bg);color:var(--ag-fg);cursor:pointer}
.ag-btn-primary{background:var(--ag-accent);border-color:var(--ag-accent);color:#fff}
.ag-input,.ag-select{font:inherit;padding:4px 6px;border:1px solid var(--ag-line);border-radius:var(--ag-radius);background:var(--ag-bg);color:var(--ag-fg)}
.ag-check{accent-color:var(--ag-accent)}
.ag-card{border:1px solid var(--ag-line);border-radius:var(--ag-radius);padding:8px;background:var(--ag-bg)}
.ag-columns{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(200px,1fr);gap:12px;overflow-x:auto;align-items:start}
.ag-column{background:var(--ag-accent-soft);border-radius:var(--ag-radius);padding:8px;display:flex;flex-direction:column;gap:8px}
.ag-list{display:flex;flex-direction:column;gap:6px}
.ag-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))}
.ag-badge{display:inline-block;padding:1px 6px;border-radius:999px;background:var(--ag-line);color:var(--ag-muted);font-size:11px}
.ag-empty{color:var(--ag-muted);text-align:center;padding:12px}
.ag-toast{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:var(--ag-fg);color:var(--ag-bg);padding:6px 10px;border-radius:var(--ag-radius)}
`

// story-only stub; replaced by BRIDGE_STUB when lane A lands. Implements the hello handshake
// and fs.* over the transferred port exactly per protocol.ts.
export const STORY_BRIDGE_STUB = `
(() => {
  const listeners = {visibilitychange: new Set(), changed: new Set(), theme: new Set()};
  const pending = new Map();
  const queue = [];
  let port = null;
  let nextId = 1;
  let resolveReady;
  const agenta = {
    version: 1, canWrite: false, dir: "", visible: true,
    ready: new Promise((r) => { resolveReady = r; }),
    fs: null,
    addEventListener(type, cb) { const set = listeners[type]; if (set) set.add(cb); return () => { if (set) set.delete(cb); }; },
  };
  const send = (req) => new Promise((resolve, reject) => {
    pending.set(req.id, {resolve, reject});
    if (port) port.postMessage(req); else queue.push(req);
  });
  const call = (method, path, body, opts) => {
    const req = {v: 1, id: nextId++, method, path};
    if (body !== undefined) req.body = body;
    if (opts && opts.force) req.force = true;
    return send(req);
  };
  agenta.fs = {
    read: (p) => call("read", p),
    readJSON: (p) => call("readJSON", p),
    write: (p, text, o) => call("write", p, String(text), o),
    writeJSON: (p, value, o) => call("writeJSON", p, JSON.stringify(value), o),
    list: (p) => call("list", p == null ? "" : p),
    exists: (p) => call("exists", p),
    stat: (p) => call("stat", p),
    remove: (p, o) => call("remove", p, undefined, o),
  };
  const applyTokens = (tokens) => {
    for (const [k, v] of Object.entries(tokens || {})) document.documentElement.style.setProperty(k, v);
  };
  const onPort = (ev) => {
    const msg = ev.data;
    if (!msg || msg.v !== 1) return;
    if (typeof msg.id === "number" && typeof msg.ok === "boolean") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) { p.resolve(msg.result); return; }
      const err = new Error(msg.error.message);
      err.code = msg.error.code;
      if ("etag" in msg.error) err.etag = msg.error.etag;
      p.reject(err);
      return;
    }
    if (msg.type === "visibility") { agenta.visible = msg.visible; listeners.visibilitychange.forEach((cb) => cb({visible: msg.visible})); }
    else if (msg.type === "changed") listeners.changed.forEach((cb) => cb({paths: msg.paths}));
    else if (msg.type === "theme") { applyTokens(msg.tokens); listeners.theme.forEach((cb) => cb({tokens: msg.tokens})); }
  };
  window.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (!msg || msg.v !== 1 || msg.type !== "hello" || !ev.ports || !ev.ports[0]) return;
    port = ev.ports[0];
    port.onmessage = onPort;
    agenta.canWrite = !!msg.canWrite;
    agenta.dir = msg.dir;
    agenta.visible = msg.visible !== false;
    applyTokens(msg.tokens);
    port.postMessage({v: 1, type: "hello-ack"});
    for (const req of queue.splice(0)) port.postMessage(req);
    resolveReady();
  });
  window.addEventListener("error", (ev) => {
    if (port) port.postMessage({v: 1, type: "error", message: String(ev.message), source: ev.filename, line: ev.lineno, col: ev.colno});
  });
  document.addEventListener("click", (ev) => {
    const a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
    if (a && port) { ev.preventDefault(); port.postMessage({v: 1, type: "nav", href: a.href}); }
  });
  window.agenta = agenta;
})();
`

/** The document the host would render: CSP, story kit, story stub, then the app itself. */
export function buildSrcDoc(html: string): string {
    const head =
        `<meta http-equiv="Content-Security-Policy" content="${RUN_CSP}">` +
        `<style>${STORY_KIT_CSS}</style>` +
        `<script>${STORY_BRIDGE_STUB}</script>`
    const at = html.indexOf("<head>")
    if (at === -1) return head + html
    const cut = at + "<head>".length
    return html.slice(0, cut) + head + html.slice(cut)
}

/** The agent's edit: one more card in the first column of whatever the drive holds now. */
export function boardWithAgentCard(current: string | undefined, configJson: string): string {
    let board: {columns: {id: string; title: string; cards: unknown[]}[]}
    try {
        board = current ? JSON.parse(current) : {columns: []}
    } catch {
        board = {columns: []}
    }
    if (!Array.isArray(board.columns) || board.columns.length === 0) {
        const config = JSON.parse(configJson) as {columns: {id: string; title: string}[]}
        board = {columns: config.columns.map((c) => ({...c, cards: []}))}
    }
    board.columns[0].cards.push({id: `agent-${Date.now()}`, text: "Added by the agent"})
    return JSON.stringify(board, null, 2)
}
