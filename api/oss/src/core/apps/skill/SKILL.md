---
name: agenta-apps
description: >-
  How to give the person a small interactive page in the drive: a board, checklist, queue, form, table or dashboard. Read it when the ask is for something to look at and touch rather than a reply. Covers picking a starter with create_app, the app folder layout, and the window.agenta bridge for hand-written apps.
---
# Agenta apps

## When

The person asks for something to look at and touch rather than a reply: a board, a checklist,
a queue, a form, a table, a small dashboard. Build an app folder in the drive; the drive renders
it in a sandboxed page and shows it as a card in the chat. Do not build one for a one-off answer.

## First

1. List `apps/*/app.json`. If an app already covers the ask, update its files; never make a
   second copy of the same app.
2. Pick a starter from the table below and call `create_app(starter, "apps/<slug>")`. Then write
   its config file and, when the person gave you content, its data file.
3. Only when no starter fits, write `app.json` and `index.html` yourself (rules below).

## Folder

`apps/<slug>/` holds `app.json` (the manifest: `agenta_app: 1`, `name`, `entry`, `access`,
`data`, `config`), `index.html`, and its data as sibling JSON files. One writer per file: the
app owns what `data` names while it is open; you own config and anything else.

## Bridge

The page gets `window.agenta`: `await agenta.ready` first; then `canWrite`, `visible`, `dir`,
and `agenta.fs` with `read`, `readJSON`, `write`, `writeJSON`, `list`, `exists`, `stat`,
`remove`. Paths are relative to `index.html` and cannot leave the folder. Events:
`agenta.addEventListener("changed", cb)` when you or the person edit a file underneath the app,
and `"visibilitychange"`. Failures reject with `error.code`: `not_found`, `read_only`, `scope`,
`conflict`, `too_large`, `bad_request`, `unavailable`. Writes carry If-Match automatically: on
`conflict`, re-read the file and reapply the change once.

## Custom app rules

- Layout with the kit classes only: `ag-app`, `ag-toolbar`, `ag-btn`, `ag-btn-primary`,
  `ag-input`, `ag-select`, `ag-check`, `ag-card`, `ag-columns`, `ag-column`, `ag-list`,
  `ag-grid`, `ag-badge`, `ag-empty`, `ag-toast`. Inline CSS only for what they do not cover.
- No external scripts, styles, fonts or images; the page cannot reach the network.
- Wait for `agenta.ready`; treat `not_found` as empty; respect `canWrite === false` by showing
  edits as unsaved instead of failing.
- Save whole files, debounced, after each change; handle `conflict` by re-read and reapply.

## Starters

| Starter | Use when | Config keys | Data files | Access |
|---|---|---|---|---|
| `board@1` | Use this when the person wants a kanban, to-do or status board: cards that move between named columns. | title, columns | board.json | read-write |

`create_app` copies the starter; `list_starters` shows this table live.

## After

Reply with the file card for `apps/<slug>/index.html`, say which access the app asks for
(`read` or `read-write`), and tell the person to choose Run on the card to open it.

<!-- owned by lane F: agent-level starters under agent-files/.apps/starters/ -->
