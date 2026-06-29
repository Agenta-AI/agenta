# Handoff: Advanced drawer — Playground build kit + collapsible sections

## Scope (read this first)

This handoff covers **two changes to the existing Advanced drawer, and nothing else:**

1. **Make the Advanced drawer's sections collapsible** (collapsed by default, expand on click) — the same accordion behavior the playground's left config panel already uses.
2. **Add a new "Playground build kit" section** to the drawer: an enable/disable toggle whose contents (skills, tools, permissions) are shown **read-only / dimmed**.

**Do NOT change anything else.** Keep the current icons, the existing section content (Authentication, Execution environment, Permissions), copy, colors, spacing, the drawer chrome (header, footer, Save/Cancel), and the playground panel as they are. Where this doc shows existing controls, that's only for context — leave them as built.

---

## About the design files

`Advanced Drawer - Build Kit.dc.html` is a **design reference written in HTML**, not production code to copy. It shows the intended look and behavior. Recreate these two changes in the real Agenta codebase (Next.js + Ant Design 6 + Tailwind) using the existing drawer component and established patterns — don't ship the HTML.

`support.js` is only the runtime that lets the HTML mock open in a browser. **Ignore it for implementation.**

To view the mock: open the `.dc.html` file in a browser. The build-kit section is expanded on load for review; click any other section header to expand/collapse it; click the toggle to enable/disable the kit.

## Fidelity

**High-fidelity.** Colors, type, spacing, and copy are final and match the Agenta design system. Recreate pixel-faithfully with the codebase's existing components.

---

## Change 1 — Collapsible drawer sections

Today every Advanced section renders fully expanded in one long scroll. Change each top-level section into a collapsible accordion item, matching the playground left panel:

- **Default state: collapsed.** (In the mock the build kit is expanded only to showcase it — in production all sections start collapsed.)
- **Header row** (always visible, click anywhere on it to toggle):
  - left: section icon (unchanged) + section title (15px / 600).
  - right: a one-line **summary** of the current value, in tertiary text `#758391` (13px), then a **chevron**.
  - Chevron is a chevron-right (`m9 18 6-6-6-6`) that rotates `90deg` to point down when open. `transition: transform .15s`.
- **Body**: only mounted when expanded. Padding `0 26px 24px`. Content is the section's existing controls — unchanged.
- Section divider: `1px solid #f0f2f5` between sections.
- Header padding: `18px 26px`. Title gap to icon: `12px`.

Summaries to show when collapsed (reuse the value already in state):
- Authentication → `Agenta-managed`
- Execution environment → `Sandbox: Local`
- Permissions → `Auto`
- Playground build kit → no text summary; the toggle (Enabled / Disabled) sits in the header instead (see below).

Multiple sections may be open at once (it's not a single-open accordion).

---

## Change 2 — "Playground build kit" section

A new collapsible section in the same drawer. Recommended position: **top of the drawer**, above Authentication. It has a subtly different background to read as a distinct (playground-only) layer.

### Purpose
Surfaces the tools, skills, and permissions Agenta auto-loads so the assistant can build/iterate on the agent inside the playground. The user can turn the whole kit **on/off**, but the individual items are **Agenta-managed and not editable**. None of it is part of the published agent — it is stripped on commit.

### Header
- Background of the whole section card: `#fcfcfa` (very slightly warm off-white, distinguishes it from the white agent-config sections).
- Icon: wrench/tools icon (same glyph as the Tools section) — `#1c2c3d`.
- Title: `Playground build kit` (15px / 600).
- Tag next to the title: small dot `#faad14` (6px circle) + text `Removed on commit` in `#ad6800` (11px / 500). Restrained — text + dot only, **no filled pill, no banner.**
- Right side: an **Enable/Disable toggle** + the chevron.
  - Toggle label: `Enabled` (`#586673`) when on, `Disabled` (`#758391`) when off.
  - Toggle track 34×20, radius 10; knob 16×16 white. On: track `#1c2c3d`, knob right. Off: track `#d6dee6`, knob left.
  - **The toggle's click must `stopPropagation`** so toggling the kit does not also expand/collapse the section.

### Body (when expanded)
1. **Intro paragraph** (13px, `#586673`, max-width ~560px):
   > "Tools, skills and permissions Agenta loads so the assistant can build & improve this agent here in the playground. Managed by Agenta — turn the kit off to test the agent as users will see it, but the items can't be edited. **None of this is part of the published agent.**"
   (the final sentence in `#1c2c3d` / 600.)

2. **When the kit is disabled**, show an info note above the groups (12.5px, `#758391`, bordered `#eaeff5` box, info-circle icon):
   > "Disabled — the assistant can no longer create files, run code, or edit this agent here."

3. Three labelled subgroups. Each label: 11px / 600 / uppercase / `letter-spacing:.05em` / `#758391`. Every row is **dimmed (`opacity: .62`)** and read-only, with a small **lock icon** (`#bdc7d1`) at the right edge.

   - **SKILLS**
     - `agenta_authoring` — "Agenta-specific skill · scaffold tools & skills, edit config"
   - **TOOLS**
     - `commit_version` — "Commit & bump versions of this agent"
     - `edit_files` — "Create & edit the agent's files"
   - **PERMISSIONS** (these rows additionally show a green `On` status pill — text `#0f8a5f`, bg `#f0faf4`, border `#c7ecd6`, radius 6)
     - `Write files` — "Filesystem · read & write"
     - `Execute code` — "Run code & files while testing"

   Row layout: `display:flex; align-items:center; gap:11px; padding:10px 12px; border:1px solid #eaeff5; border-radius:8px; background:#fff`. Leading 28×28 mono chip (`#f5f7fa` bg, `#586673` text) for skills/tools, or the permission icon for permission rows. Name in JetBrains Mono 12.5px/500 (skills & tools) or Inter 13px/500 (permissions). Description 11.5px `#758391`.

> The exact item list (`agenta_authoring`, `commit_version`, `edit_files`, write/execute) is illustrative of the categories — confirm the real set with the backend. What matters for this change is the **structure**: three read-only groups (skills, tools, permissions) under one enable/disable, never-editable kit.

---

## State

Add to the drawer's local state:
- `openSections`: which sections are expanded (default: all collapsed in production).
- `buildKitEnabled: boolean` (default `true`).

Transitions:
- Click a section header → toggle that section's open flag.
- Click the build-kit toggle → flip `buildKitEnabled` (and `stopPropagation`).

No new data fetching introduced by the layout itself. The build-kit contents come from whatever Agenta already injects for playground sessions; this UI only reflects + enables/disables it.

---

## Design tokens used

- Text: `#1c2c3d` primary, `#586673` secondary, `#758391` tertiary, `#bdc7d1` disabled/placeholder.
- Borders / dividers: `#f0f2f5` (section dividers), `#eaeff5` (row borders), `#d6dee6` (input borders).
- Build-kit surface: `#fcfcfa`.
- Amber accent (Removed-on-commit): dot `#faad14`, text `#ad6800`.
- Green status (`On`): text `#0f8a5f`, bg `#f0faf4`, border `#c7ecd6`.
- Brand / toggle-on / Save button: `#1c2c3d`. Toggle-off track: `#d6dee6`.
- Radius: 6px inputs, 8px rows, 10px cards. Font: Inter; mono: JetBrains Mono.

## Files

- `Advanced Drawer - Build Kit.dc.html` — the design reference (full app shell with the drawer open; the drawer is the only thing in scope).
- `support.js` — mock runtime only; ignore for implementation.
