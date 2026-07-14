# Agent config section drawers

Status: in progress. Shipped: Instructions, Model & harness, and Advanced as section drawers.
Branch: `fe-feat/agent-config-section-drawers` (off `big-agents`).

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

## Model & harness + Advanced (shipped)

Both are singleton sections, so they don't fit the collection (list of rows) shape. Instead the
accordion header itself opens a drawer: `ConfigAccordionSection` gained an `onOpen` prop (header
acts as a button with a right chevron, no inline body), and a shared `SectionDrawer` wraps the
content. Draft/Save is a whole-config snapshot taken on open and restored on Cancel (edits apply
live through the existing handlers; Cancel reverts). Both drawers are two-panel: settings on the
left, a (stubbed) version-history rail on the right.

Model & harness drawer (when inspect `harness_capabilities` is present): harness capability cards
(providers, hosting/deployments, model count, and a per-card keeps/clears-your-model status), the
model picker, and a compatibility panel (current model/auth reachability + a per-harness "if you
switch" list). Falls back to the plain harness select when capabilities aren't available.

Advanced drawer: Authentication was moved here from Model & harness. Grouped, explained
sub-sections — Authentication, Execution environment (sandbox + sandbox permissions), Permissions
(permission policy + Claude permissions). Conditional rendering is real: Claude permissions only on
the Claude harness; a note that permission policy isn't used by Pi.

### Known gap — harness capability coverage is partial (do not forget)

`harness_capabilities` (from `/inspect`) currently exposes only **providers, connection modes,
models, and hosting/deployments**. It does NOT describe which **tools, skills, or MCP servers** a
harness supports. Consequences:

- The Model & harness compatibility panel + the per-card model-support status only reason about the
  MODEL and auth, not about tools/skills/MCP. Switching harness could silently leave tools that the
  target harness can't run, and we do not warn or gate them.
- Switching harness does NOT clear the model, even when the current model id isn't valid under the
  new harness (different namespaces — Claude uses aliases like `sonnet`, Pi uses provider-qualified
  ids). The model is kept and the compatibility panel flags it as not reachable so the user can pick
  a new one (Arda's call: keep the choice over silently wiping it). Trade-off: Save can persist an
  unreachable model that errors at run time. We deliberately do NOT auto-remap.

When the backend extends `harness_capabilities` with tool/skill/MCP support, extend the
compatibility panel to warn (and optionally lock the Tools/Skills/MCP sections) on an unsupported
switch, mirroring the model warning. Tracked as the harness-gating follow-up.

## Deferred

- Tool/skill/MCP harness gating — blocked on the `harness_capabilities` extension above.
- Real multi-file CRUD for Instructions (add/rename/remove) — lights up when the backend exposes
  multiple defs.
- Version-history data wiring (real per-field revision diffs) for all three drawers — replaces the
  shared `versionHistorySkeleton`.
- Reference (`@ag.reference`) chips in the editor — they live on the embedref branch (#4877) and
  light up here when that merges.
- Optional: model remap (instead of clear) when switching harness.
- Tool draft validation depth — the per-kind `draftInvalid` only checks an inline function's name
  today. Under the incoming `kind`-discriminated tool schema (`schema-driven-config-proposal.md`,
  CHANGE-3) every entry must validate against its per-kind sub-schema. Tighten when that lands; the
  registry's per-kind `draftInvalid`/`createSeed` get replaced wholesale (the current `tool.createSeed`
  is an unused stub — creation seeds from the picker). Raised from PR #4923 review.
- Named-connection slug on a provider change — intentionally kept today (the option list is
  vault-secret async, so an eager clear would wipe a valid slug mid-load). When provider becomes
  first-class via `ModelSpec` (`../agent-workflows/scratch/notes-model-auth.md`, R2), re-bind or clear the slug when the
  derived provider changes. Raised from PR #4923 review.

## Schema-driven section work package

After #4913 landed the nested `agent-template` catalog type, the panel can read more from the
template shape instead of hardcoding it. The control is schema-*gated* (which sections/options
exist) but not yet schema-*driven* (identity, structure, controls, discrimination). This package
closes that to the extent #4913's schema supports; the gated tail waits on later schema steps.

What #4913 makes available: every field has a `title`/`description`; `harness.kind` carries
`x-ag-harness-ref: "harness"` plus a `oneOf` of `{const, title}`; `ToolConfig` is a real
`discriminator: "type"` union (builtin/gateway/code/client/reference/platform) exposed in the JSON
schema; `harness.permissions` / `sandbox.permissions` are fully typed sub-schemas; `instructions`
→ `x-ag-type: "textarea"`, `llm.model` → `x-parameter: "grouped_choice"`.

- [ ] **G1 — Section identity from schema.** Derive each per-field section's title + description
  (tooltip) from `props.<field>.title` / `.description` instead of literals; order the list sections
  by schema property order. Composite sections (Model & harness = `llm`+`harness`, Advanced =
  `runner`+`sandbox`+`harness.extras`/`permissions`) keep their FE labels, and Triggers (non-schema)
  stays FE. Icons stay FE (not in schema).
- [ ] **G2 — Discriminator-aware item classification.** Read the declared discriminator (`ToolConfig`
  `discriminator: "type"`) from the schema where present, falling back to today's sniffing. MCP
  (`transport` presence) and embed/skill refs (`@ag.embed`, `x-ag-type-ref: "skill-template"`) have
  no discriminator declared, so they stay sniffed. *Gated tail:* fully adopting the six-kind tool
  union (the FE's inline `type:"function"` shape is not in `ToolConfig`) belongs with the
  schema-driven-config redesign (CHANGE-3).
- [ ] **G3 — Follow `x-ag-harness-ref`.** Resolve the harness capability catalog from the schema's
  `harness.kind["x-ag-harness-ref"]` declaration rather than the hardcoded `/catalog/harnesses/`
  assumption; behavior is identical today (one catalog) but the dependency is now declared, not
  assumed.
- [ ] **G4 — Schema-sourced permission editor.** Source the harness-permissions editor's option set
  (`default_mode` enum) and field labels/tooltips from the typed `harness.permissions` sub-schema
  instead of hardcoded literals, keeping the rich control. *Gated tail:* per-harness show/hide still keys off
  the harness value (`=== "claude"`) because neither the schema nor the harness catalog yet carries a
  per-harness "is-gating" capability flag; make it schema-driven when that flag exists.

## Verification

`tsc` + `eslint` clean on `@agenta/ui` and `@agenta/entity-ui`; package unit tests for the new
pieces (section renders the file row; drawer save applies the draft, cancel discards). Live QA by
the user.
