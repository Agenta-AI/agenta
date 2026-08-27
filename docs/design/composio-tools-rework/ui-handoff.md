# Handoff: Playground integration permissions

## Overview
Redesign of how tools are managed in the Agenta agent playground. The old model (pick individual actions per integration via the "Add app tools" catalog) is replaced by an **integration-level model**: adding an integration adds ALL of its tools; what the user configures is the integration's **default permission**, with optional per-tool overrides (Custom). Three surfaces change:

1. **Playground Tools section** — integration rows with a permission glyph summary; clicking a row opens the integration permission drawer.
2. **Integration permission drawer** — default-permission preset + per-tool permissions, grouped read-only vs write & delete, built to scale to 100+ tools.
3. **Add integration drawer** — replaces the "Add app tools" catalog: search & add whole integrations, quick-add from workspace connections, pick a connection when several exist.

The final agreed direction is **option 2a** in `ui-handoff-board.html` (the topmost section). Sections 1a/1b below it are earlier explorations kept for reference — do not implement them.

## About the design files
The file in this bundle is a **design reference created in HTML** — a static high-fidelity mock showing intended look and behavior, not production code. Recreate it in the Agenta web codebase (`Agenta-AI/agenta`, `web/packages/agenta-entity-ui`) using the existing React + Ant Design 6 + Tailwind patterns. Relevant existing modules (read these first):

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolPermission.ts` — per-tool permission already exists as `"allow" | "ask" | "deny"` on `tools[]` entries; the integration default becomes a new integration-level setting that resolves to these.
- `.../SchemaControls/agentTemplate/ToolManagementList.tsx` + `.../sectionGroups.tsx` — the Tools section & provider groups to replace with integration rows.
- `.../agentTemplate/AgentIntegrationDrawer.tsx` + `.../drawers/shared/CatalogChooser.tsx` — the current "Add app tools" drawer this replaces.
- `.../gatewayTool/drawers/ConnectDrawer.tsx` — auth flow reused by the "Connect" button.
- Read-only classification comes from the catalog action's `read_only` flag (`item.readOnly` in CatalogChooser).

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and copy follow the Agenta design system (warm recolor, v0.112.0 `palette.ts`). Recreate pixel-perfectly with existing Ant/`--ag-*` tokens; hex values below map onto those tokens.

## Permission model
- Integration default presets: **Always ask** · **Ask for write & delete** (default for newly added integrations) · **Allow all** · **Deny all** · **Custom**.
- Per-tool values: **Ask** · **Allow** · **Deny** (matches `ToolPermission`).
- Setting any per-tool value switches the integration default to Custom (also selectable directly).
- All tools of an integration are always included; Deny is how a single tool is disabled.
- Permission glyphs (used everywhere a permission is summarized):
  - bell = always asks
  - pencil = allows reads, asks to write
  - check in circle = allow all
  - circle with slash = deny
  - sliders = custom

## Screens / views (option 2a frames, left to right)

### 1 · Playground — Tools section
- Section label `INTEGRATIONS` (uppercase 11px/500, letter-spacing 0.05em, #848b8c) + count pill (11px mono on #f0efed, radius 9px) + a plus icon button right-aligned that opens the Add integration drawer.
- One row per integration: 1px #e5e5e3 border, radius 8px, padding 10px 12px, gap 10px; app logo 20px; name 14px/500 #242424; right side: permission glyph (13px stroke icon #848b8c) + short label 12px #676770 (Custom uses #8a6400 and appends override count, e.g. "Custom · 2"); chevron-right 13px #a3a19f. Row hover #fbfaf8. Click opens the integration permission drawer.
- "Tool definitions" subsection unchanged (mono name rows).
- No per-row expansion and no per-row plus anymore.

### 2 · Integration permission drawer
- Right-side drawer ~480px. Header: close button (26px, 1px #e5e5e3, radius 6px), app logo 22px, name 14px/600, subtitle 12px #848b8c `Integration · {key} · {connection} connection`; right: green dot (#12b76a, 6px) + "Connected" 12px #2e7d3a. Header border-bottom 1px #e5e5e3.
- **Default permission**: labelled select (34px, 1px #d7d7d7, radius 6px, 13px) whose value shows glyph + preset name. Open menu: white, radius 8px, dropdown shadow, options = glyph 14px + name 13px + one-line description 11px #848b8c; active option bg #f6f5f3 + check; divider (1px #f0efed) before Custom. Option descriptions: "Approval before every run" / "Read-only tools run automatically" / "Everything runs without asking" / "Tools stay listed but never run" / "Per-tool permissions below".
- **Tool search**: 32px input "Search {N} tools" (needed — integrations can have 50–200+ tools).
- **Tool groups**: two collapsible cards, `READ-ONLY · n` and `WRITE & DELETE · n`. Group header: caret, uppercase 12px/500 label, bg #fbfaf8, right-aligned rollup (glyph + "runs automatically" / "asks first"). Collapsed group is a single header row.
- **Tool rows** (inside expanded group): name 13px/500; description one line, truncated, 12px #848b8c, with an olive (#5e5e08) "Show more" link when truncated / "Show less" when expanded (expanded row bg #fbfaf8, full description 12px #676770 line-height 1.5). Right: per-tool select trigger — 1px #d7d7d7, radius 6px, padding 2px 8px, 12px, glyph + value + caret. Deny state: bg #f9e5e5, border #d94c4a, text #5e0908/500. Per-tool menu options: Always ask ("Approval before every run") / Allow ("Runs without asking") / Deny ("Never runs").
- Long groups end with an olive "Show N more" row.
- Footnote 12px #848b8c: "Setting a tool's permission switches the default to Custom."
- Footer: border-top 1px #e5e5e3, right-aligned ink Done button (bg #242424, white, radius 6px, padding 4px 14px, 13px). No footer helper text.
- Body scrolls (slim 6px trackless scrollbar, thumb rgba(36,36,36,0.22)).

### 3 · Add integration drawer
- Drawer ~680px, header "Add integration" (plugs icon + 14px/600). Two columns:
  - **Left rail (176px, border-right 1px #f0efed): categories** — uppercase `CATEGORIES` label + vertical list (13px, padding 4px 8px; active = bg #f0efed, radius 6px, 500, #242424). Rail is independently scrollable.
  - **Main column (scrollable)**: search input on top (focus style: border #d9d92c + 3px rgba(217,217,44,0.25) ring).
    - Section `CONNECTED IN YOUR WORKSPACE · n`: rows in a bordered list (logo 20px, name 13px/500, subtitle 12px #848b8c = connection slug/account). Right-side state: outlined **Add** button (1px #d7d7d7, radius 6px, 12px) · green check + "Added" (#2e7d3a) once added. Show ALL connections (no "Show all" link).
    - Multi-connection integration: row expands to "Choose connection" with radio rows per connection (selected = 1px #242424 border + filled radio) and an ink button "Add with {connection}".
    - Section `ALL APPS · n`: same row shape, one-line truncated description, right button **Connect** — runs the existing ConnectDrawer auth flow, then the integration is added with the default permission.
  - No tool counts, no per-action lists, no "connected app" copy anywhere (connections belong to the workspace; what the agent gets is an integration).
- Footer: right-aligned Done only.
- Behavior: adding is immediate with default "Ask for write & delete"; configuring happens later from the Playground row (or by clicking an added row).

## Interactions & behavior
- Playground row click → integration permission drawer. Panel plus → Add integration drawer.
- Preset select change: rewrites per-tool effective permissions; picking a preset from Custom resets overrides (copy: "Picking a preset resets them").
- Per-tool change → default becomes Custom; Custom select value shows an amber count tag ("N overrides", bg #fbf3d9 / #8a6400).
- Add flow: Add / Add with {connection} / Connect-then-add — all land the integration with the default preset; drawer stays open (multi-add), Done closes.
- Changes apply to the draft config immediately (same write-through as `withToolPermission` in toolPermission.ts).
- Hovers: rows rgba(36,36,36,0.04); no scale transforms. Transitions ≤300ms ease.

## State management
- Per integration in the agent template: `{ integrationKey, connectionSlug, defaultPermission: "ask" | "ask_write" | "allow" | "deny" | "custom", overrides: Record<toolKey, "ask" | "allow" | "deny"> }` (or keep per-tool `permission` on `tools[]` entries as today and derive the preset).
- Derived: override count, effective per-tool permission (group default vs override), read-only/write partition (catalog `read_only`), rollup summaries.
- UI state: group expand/collapse (persist like `agenta:tools:groups-expanded`), per-row description expand, tool search query, category filter, connection radio selection.

## Design tokens (light mode)
- Ink #242424 · hover #413f3f · secondary text #676770 · tertiary #848b8c · disabled #a3a19f
- Borders: controls #d7d7d7 · cards #e5e5e3 · row dividers #f0efed
- Backgrounds: white · paper #fbfaf8 · subtle #f0efed · ground #f6f5f3
- Focus: border #413f3f (yellow #d9d92c on search) + ring rgba(217,217,44,0.35)
- Semantic: success #2e7d3a / dot #12b76a · error text #5e0908, border #d94c4a, bg #f9e5e5 · amber #8a6400 / #fbf3d9 · olive links #5e5e08
- Radii: 6px controls · 8px cards · 12px drawer corners in the mock (real drawers are full-height)
- Type: Inter; 14px names/body, 13px controls, 12px descriptions/labels, 11px uppercase section labels; weights 400/500/600 only
- Icons: outlined, 1.5–2px stroke, 11–15px in this UI (Phosphor equivalents: Bell, PencilSimpleLine, CheckCircle, Prohibit, SlidersHorizontal, CaretRight/Down, MagnifyingGlass, Plugs, Plus, X)

## Assets
App logos come from the tool catalog (`integration.logo`), as today. The mock uses simpleicons CDN + monogram-square fallbacks — production keeps the existing `ProviderLogo` fallback (Plugs glyph).

## Files
- `ui-handoff-board.html` — the design board. **Section 2a (top) is the spec**; frames left→right: Tools panel, default-permission menu, tools-at-scale drawer, add-integration drawer. Sections 1b/1a are earlier iterations for context only.
