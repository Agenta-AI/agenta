# Skill registry — UI/UX plan

Status: mockups approved in review with Arda, 2026-09-05. Companion to
[discovery.md](./discovery.md) (codebase map, backend architecture, import pipeline).

Interactive mockups (source of truth for look and flow, drawn pixel-accurately against
the live app):
<https://claude.ai/code/artifact/c8901092-a2b1-46dd-9b2d-6cde83cec201>
— 19 artboards + a fully clickable prototype covering every flow below. Artboard IDs in
this document (1, 2b, 4d, 5a, …) refer to that canvas.

## Principles

1. **Registry by default.** Creating a skill anywhere — registry page, agent config —
   creates a standalone registry skill (v1) that agents reference via embed. There is
   no inline-vs-embedded split and no "export to registry" step (Mahmoud's direction,
   Slack 2026-09-03).
2. **One drawer shell.** Detail, edit, and create are the same drawer component in
   different modes; the mode swaps the rail's bottom card and the read-only state.
3. **One create action.** A single `+ New skill ▾` dropdown (write / upload / import)
   appears identically everywhere a skill can be created.
4. **Follow-latest is the default; pinning is opt-in** and one caret away, never a
   separate form step.
5. **Imports are snapshots.** Nothing runs from a repo; sync offers new versions, never
   silently applies them (pipeline in discovery.md).

## Surfaces and touchpoints

### Sidebar

New top-level **Skills** entry (same slot style as Agents/Sessions). Selected state =
the standard white pill.

### Registry page (artboard 1)

Templates-gallery pattern: left source rail (All / This project / Agenta /
per-imported-repo, with counts), search, sectioned 3-column card grid. Card: `sk`
square avatar (olive = project, gray = imported, ink+lightning = Agenta built-in),
mono name, version tag, 2-line description, meta (files · used-by · age). Imported
sections carry a "synced Xd ago" tag. Header holds the single split
`+ New skill ▾` button; its menu: **Write from scratch**, **Upload a folder/.zip/.skill**,
**Import from a repo…** (GitHub or Claude/Codex marketplace).

### Skill drawer — one shell, three modes

Editor anatomy throughout: left rail (Files list + a bottom card) and a right form
column (Name, Description, SKILL.md), footer actions right-aligned.

- **Detail / read-only (2, 2b)** — rail bottom card = **VERSIONS** (replaces the
  dropzone): v-rows with tag, message, age; click to navigate revisions. Right column
  renders the selected revision's content read-only; USED BY chips (agent + its pin)
  below. Footer: `Edit skill` + `Add to agent`. Older revision (2b): "viewing vN" tag,
  read-only note, footer becomes `Restore as vN+1` + `Add to agent · pin vN`
  (restore = a normal new commit).
- **Edit (5a)** — today's real editor: Form|JSON toggle, rail with dropzone card,
  rich-text SKILL.md with Source toggle. Reached from detail's `Edit skill` or an
  agent's skill row. Save triggers the save dialog (5b).
- **Create (1b)** — same drawer, empty; footer says where the result lands ("registry
  as v1"). Create returns to the registry (or adds to the agent when opened from one).

### Upload states (1c, 1d, 1e / agent-side 4d–4f)

- **1c empty**: the drawer is a single large dropzone ("nothing is created until you
  review"). The full-drawer zone exists ONLY in this truly-empty state.
- **1d parsed**: the drawer transforms into the editor shell — files parsed into the
  rail, name/description prefilled from frontmatter, "N files parsed" tag → review →
  Create.
- **1e invalid**: errors render IN the upload view, not the editor: red panel (e.g. no
  root SKILL.md), recovery list (nested skills found → selectable multi-import,
  "Import N skills"), gold warnings (oversized/binary files skipped), and the same
  dropzone below as the retry target.

### Import from a repo (6 / agent-side 4g)

Drawer (app is drawer-first, not modal-first): URL field + Scan → found-skills list
with checkboxes and `SKILL.md +N` size tags → "Keep in sync" checkbox → trust note
(snapshot, executables disabled) → footer `Import N skills`.

### Pick agents (3)

From the registry detail, `Add to agent` advances to a second step in the SAME drawer
(back chevron): checkbox rows for agents without the skill ("will follow latest"),
already-added agents shown read-only with their pin (a stale pin surfaces
"vN available"), footer split `Add to N agents ▾` (caret = version options for the
batch). Confirm returns to the registry. Never navigates into a playground.

### Agent config, playground (4, 4b, 4c)

- **At rest (4)**: the real flat-row panel. Skill rows are references with version
  tags: green `Latest · vN` (follows), neutral `Pinned · vN` (+ gold `vM available`
  nudge), `Locked` for Agenta built-ins. Row click opens the skill drawer (edit mode);
  the row's `+` opens the picker.
- **Add-skills picker (4b)**: Add-subagents anatomy — search, `SKILLS · N` + Add all,
  rows with split `[Add | ▾]` (Add = follow latest one-click; caret menu = "Add —
  follow latest / Add pinned to vN"), Added rows flip to Remove. Bottom: the same
  `+ New skill ▾` dropdown as the registry ("write, upload, or import — created in the
  registry").
- **Create from agent (4c–4g)**: identical drawers rendered in playground context;
  created/imported skills land in the registry AND on this agent.

### Save dialog (5b) — PROPOSED change to current behavior

Today the app auto-commits config edits silently (verified live: adding a skill bumped
the agent v3→v4 with only a fleeting Undo toast). Once skills are shared, a silent
save that ships to every following agent is unacceptable. Saving a skill therefore
opens a blast-radius dialog: vN → vN+1, "what changed" message, the list of using
agents with per-agent effect ("gets vN+1 on its next session" / "stays pinned — not
affected"), and the note that running sessions finish on their current version.
Fallback option if the team prefers auto-save: version toast with Undo.

## Interaction conventions (established during review)

1. **Nested drawers show a back chevron**, not a close X; page-opened drawers keep X.
2. **Dropdown-button UX for any action with variants** (create, add-with-version,
   batch-add) — never segmented controls or always-visible option rows.
3. **Version choice is progressive disclosure**: visible only behind the Add caret or
   the versions rail; plain actions default to follow-latest.
4. **Upload morphs, uploader never changes shape arbitrarily**: full-drawer zone only
   when empty; after any drop the editor shell owns layout and errors render in-view.
5. **Sequencing**: nothing pre-opened — panels at rest, drawers open from their
   trigger, close back to where they came from.

## Component mapping (build against these; extract, don't duplicate)

| Mock element | Existing component / seam |
|---|---|
| Registry page | `@agenta/home-ui` `TemplateGallery`/`TemplateCard` pattern |
| Skill drawer shell | `EnhancedDrawer` + `ConfigItemDrawer` + `SkillFormView` (gains read-only mode + versions rail card) |
| Upload parsing | `SkillUploadZone`/`skillUpload.ts` (client), server pipeline in discovery.md |
| Add-skills picker | `AddSubagentDrawer` anatomy, fed by a skills list |
| Pick-agents step | same drawer, agent roster (`agentRoster.ts`) |
| Save dialog | `EntityCommitModal` + new blast-radius panel (used-by = reverse-embed query) |
| Version navigation | workflow revisions (already git-backed); `UnifiedEntityPicker` revision adapter if a full picker is ever needed |
| Skill rows in config | `ItemRow`/`itemDescriptors` `describeSkill` (gains version tags) |

FE gaps to build (detail in discovery.md): the `@ag.embed` writer, `is_skill` in
`WorkflowQueryFlags` + a skills list atom, the registry route + sidebar entry, the
reverse "used by" query.

## Existing-component UX issues to fix during the build

1. New-skill drawer: Create disabled with no validation hint when SKILL.md is empty.
2. Silent auto-commit of config edits (v3→v4) with no version feedback — superseded by
   the save dialog above for skills; consider the same for other config sections.
3. Skill rows show no version info; the redundant "skill" tag inside the Skills
   section.
4. Form|JSON toggle is easy to miss top-right.

## Decisions taken (flag to reopen)

1. v1 registry is project-scoped; org-wide sharing later (publication records, see
   discovery.md).
2. Install is explicit per agent — no registry mount. "Auto-discovery" is realized
   as AGENT-DRIVEN install: a registry-search platform tool + the existing
   self-config ops (the op catalog already edits the skills list) + the normal
   approval flow. The agent performing the explicit install IS the auto-discovery.
   "Add all" stays the human low-friction path.
3. Imports are snapshots; sync offers versions, never applies them.
4. Follow-latest default, pin opt-in.
5. Shared-skill edits get the explicit save dialog (vs today's silent auto-commit).
6. Registry-side install is batch (one skill → many agents); agent-side is the
   reverse; same embed primitive underneath.
7. Local edit to an imported skill detaches it from sync ("modified locally").

## Still open

1. Migration story for existing inline skills (auto-migrate on next commit vs prompt
   vs dual support).
2. Name collisions (registry-wide and per-agent) — block vs auto-suffix.
3. Whether non-skill config sections also move off silent auto-commit.
