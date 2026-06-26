# Agent config section drawers

Status: in progress (v1 = Instructions). Branch: `fe-feat/agent-config-section-drawers` (off `big-agents`).

## Problem

The agent config panel (`AgentConfigControl`) shows every section's full editor inline. The
heavy ones (Instructions, Model & harness, Advanced) are always on screen, so the panel reads
as crowded and intimidating, and there is no room to add richer per-section UX (a markdown
toolbar, explanatory cards, version history). Most of these configs change rarely, especially
once auto-improvement does the heavy lifting, so keeping them fully expanded is the wrong default.

## Approach

Extend the pattern already used for Tools and Skills: the section shows a compact summary, and
the real editing happens in a right-hand drawer. Tools/Skills/MCP are *collections* (summary
count + a list of item rows, each row opening a drawer). The other sections fold into the same
model rather than a new "singleton" variant.

Instructions is the first section, and it turns out to fit the collection model directly: it is
becoming a set of markdown definition files (`AGENTS.md`, `persona.md`, …). So Instructions
becomes a file list exactly like Tools/Skills, each file row opening an editor drawer.

## v1 scope: Instructions

Today the backend stores a single `agents_md` string. v1 ships the list pattern over that one
field, structured so it scales to many files with no rework.

Panel (the section):
- Header: icon + "Instructions" + file count + a `+` that is rendered but **inert/disabled**
  (tooltip: multiple instruction files coming soon) until the multi-def backend lands.
- File rows (reuse `ItemRow`): file icon + filename (`AGENTS.md`) + a truncated, syntax-stripped
  preview of the markdown. The row opens the drawer.
- v1 renders exactly one row, a view over `[{name: "AGENTS.md", content: agents_md}]`.

Drawer (`InstructionsDrawer`, on `EnhancedDrawer`):
- The markdown editor (reuses `MarkdownEditor`, which already has a source ↔ rendered toggle, so
  Preview is free) plus a right rail.
- Right rail: suggested-action chips and a **version-history skeleton** (placeholder only —
  "soon"). Real revision-diff data is deferred.
- Footer: a draft note + Cancel / Save. Edits live on a draft and only apply to the config on
  Save (same model as the tools/skills drawer).

Data flow: the drawer edits a draft string; Save calls `setField("agents_md", draft)`.

## Deferred

- Real multi-file CRUD (add/rename/remove) — lights up when the backend exposes multiple defs.
- Version-history data wiring (revision diffs of one field) — its own increment.
- Drawer-level `Edit | Preview` segmented + a Preview **Expand** to a full-height read-only view,
  and a dedicated markdown formatting toolbar — fast-follow after the structural cut.
- Applying the same summary + drawer treatment to Model & harness and Advanced.
- Reference (`@ag.reference`) chips in the editor — they live on the embedref branch (#4877) and
  light up here when that merges; v1 does not depend on them.

## Verification

`tsc` + `eslint` clean on `@agenta/ui` and `@agenta/entity-ui`; package unit tests for the new
pieces (section renders the file row; drawer save applies the draft, cancel discards). Live QA by
the user.
