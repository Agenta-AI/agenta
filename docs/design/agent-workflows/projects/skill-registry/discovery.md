# Skill registry — discovery (issue #5512 / AGE-3997)

Status: discovery. Codebase mapped 2026-09-03. No decisions locked.

## Product intent

Issue #5512: publish a skill once, discover/search skills, install into an agent with
versioning (pin or follow). One comment (Abhishekvrshny) asks for importing skills by
GitHub repo URL from the Claude/Codex plugin marketplaces (like Hermes).

Slack (2026-09-03, #product thread) — Mahmoud's current thinking, which **supersedes his
older "export to registry" UX** (he calls it too complex):

1. **Registry by default.** Creating a skill puts it in the registry automatically
   (stored as an embed, not inline config). Agents can reference — even auto-discover —
   all registry skills. No explicit publish step.
2. **External sources.** Load skills from GitHub repos and Claude/Codex-style
   marketplaces, browsable dynamically inside Agenta. Agenta in-house skills live there
   too.
3. **Start with UX mockups** and iterate; implementation is considered straightforward,
   UX is the hard part.

### Implications of "embedded per default"

Mahmoud's model inverts today's authoring flow, and that inversion is most of the build:

- Today "Add skill" in the agent config creates an **inline** `SkillTemplate` inside
  `parameters.agent.skills[]`; his old UX added an "export to registry" step that
  converts inline → embed. Embed-by-default removes the conversion entirely: creating a
  skill — anywhere, including from inside an agent config — creates a **standalone skill
  workflow** plus an `@ag.embed` ref in the agent. There is nothing to export because
  nothing was ever inline.
- Ripple effects:
  - The agent-config "Add skill" drawer must `createWorkflow` (skill URI) + write an
    embed, not append inline JSON — the FE embed writer becomes the critical path.
  - **Editing a skill changes entity.** Today it's part of the agent's dirty state and
    commit; embedded, it's a revision commit on the *skill* workflow, with its own
    commit modal/lifecycle, while the agent config is untouched (unless the pin moves).
    This is the main UX surface to mock.
  - Follow-latest + a live agent session = **environment rebuild** on every skill edit
    (runner reconciliation defaults to rebuild) — expect "skill changed, session
    restarts" moments; needs UX handling.
  - **Existing inline skills** need a story: silent auto-migration on next commit,
    one-time prompt, or indefinite dual support (dual support = permanent UX split).
- "Reference easily all skills / auto-discover": at minimum a picker listing every
  registry skill; possibly a wildcard/registry-mount (decision #2 below).
- Context from the same thread: registry is one of three open UX-hard tracks
  (automations, onboarding are the others); Apps / file drawer / arg.ai-style gadgets
  are explicitly *after* — out of scope here.

### Competitive reference: Langdock skills registry (screenshots, 2026-09-03)

- Distribution unit is a **skill pack** (curated domain collections "By Langdock", 6–9
  skills each: Marketing, Design, Engineering, Finance, …) with **Upload pack** and
  per-pack **Download** — portable bundles both ways. A GitHub repo import is the same
  concept; pack export would complete the loop.
- Governance lives in workspace **Settings**, split from browsing: general-access
  toggle, member/group grants, per-pack Available switches. Their substitute for
  project/org data scoping is availability toggles.
- **Skills is a top-level sidebar product** beside Agents/Workflows.
- Hover popover on a pack lists its skills (name + one-liner) — cheap disclosure.
- Absent there (Agenta's edge): versioning, pin/follow, per-agent install state,
  edit blast-radius.

## What exists today (verified against code, 2026-09-03)

Design docs: `docs/design/agent-workflows/projects/skills-config/{architecture,build-notes}.md`.
**Doc drift:** they say `_agenta.*` / `is_platform` / `PlatformWorkflowCatalog`; shipped
code uses `__ag__` / `is_static` / `StaticWorkflowCatalog`. Trust the code.

### Data model

- A skill is a **workflow revision** with `data.uri == "agenta:builtin:skill:v0"` and
  content at `data.parameters.skill` (a `SkillTemplate`: kebab `name`, `description`,
  `body` ≤50k, `files: SkillFile[]` ≤200k each, `disable_model_invocation`,
  `allow_executable_files`). Model: `sdks/python/agenta/sdk/agents/skills/models.py`.
- `is_skill` is **revision-level only** (`api/oss/src/core/workflows/dtos.py:145`);
  `WorkflowArtifactFlags` (`dtos.py:121`) has no `is_skill`, so artifact-level
  `POST /workflows/query` cannot filter skills.
- An agent references a skill via `@ag.embed` in `parameters.agent.skills[]`:
  - `@ag.references.workflow {slug}` → resolves to head = **follow latest**
  - `@ag.references.workflow_revision {slug, version}` → **pinned**
  - Pin/follow is implicit in the reference *level* (`api/oss/src/core/embeds/utils.py:293-333`);
    a bare `workflow_revision.slug` without version 500s (revision slugs are hash slugs).
- Built-in platform skills: `api/oss/src/core/workflows/static_catalog.py` —
  `_STATIC_WORKFLOWS` keyed by reserved `__ag__*` slugs, resolved in code before any
  SQL, write-blocked, release-coupled. Two skill entries today; content authored in
  `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`.
- SKILL.md is **composed** at run time in the runner
  (`services/runner/src/engines/skills.ts` `composeSkillMd`), never parsed anywhere.

### Resolution path

SDK detects `@ag.embed` and delegates: `POST /workflows/revisions/resolve`
(`sdks/python/agenta/sdk/middlewares/running/resolver.py:485` →
`api/oss/src/apis/fastapi/workflows/router.py:2040` → `EmbedsService`). Resolution
happens at save/read/invoke time in the API, never in the runner.

### Runner usage (how skills reach the model)

- One engine (`sandbox_agent`). Skills are never injected into a system prompt — only a
  pointer line ("Your rendered skill files live at `<path>`",
  `services/runner/src/engines/sandbox_agent/platform-guidance.ts:76`). Disclosure is
  progressive: harness sees frontmatter name+description, reads the body on selection.
- Materialization is **once per session build** (`buildRunPlan` →
  `plan.workspace.skillDirs`), not per turn. Claude/Codex: copied to project-local
  `.claude/skills/<name>` / `.codex/skills/<name>` under the session cwd (Claude picks
  them up via `settingSources: ["user","project","local"]`). Pi: content-addressed
  snapshot at `agents/skills/<sha256>`, exposed via `PI_CODING_AGENT_SKILL_DIR`.
- `disable_model_invocation` → one frontmatter line (`disable-model-invocation: true`);
  interpreted by the harness's own skill loader (hidden from auto-list, `/skill:name`
  only).
- A skills edit on a live session defaults to **environment rebuild**
  (`reconciliation-router.ts:56-90`); in-place refresh exists but refuses for Pi.
- Unresolved `@ag.embed` never reaches the runner (SDK parse error,
  `sdks/python/agenta/sdk/agents/skills/parsing.py:29`); if one arrives via raw POST the
  runner skips the skill with a log, run continues.
- `harnesses.py` passes identical `skills=` to all three adapters; all divergence is in
  the runner. Stale bits: the Codex "later milestone" comment (`harnesses.py:116`), and
  `skills-config/architecture.md:89,144` ("Claude SDK drops skills") — superseded by the
  `.claude/skills` write path.

### Frontend

- **No FE code ever writes an `@ag.embed`** — only reads/preserves. Embeds reach configs
  via backend build-kit overlay, the static catalog, or hand-edited JSON.
- Skill rows render via `describeSkill` in
  `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/itemDescriptors.tsx:303`;
  a pinned `version` is *displayed* as a tag but nothing can set it.
- `is_skill` exists in `workflowFlagsSchema` but is **absent from `WorkflowQueryFlags`**
  (`web/packages/agenta-entities/src/workflow/core/schema.ts:132-149`) — FE can't query
  skills. No skills list atom, no browse route, no sidebar entry.
- Inline skill authoring exists: `SkillFormView` (two-pane SKILL.md editor) +
  `SkillUploadZone` (folder/.zip/.skill upload → `ParsedSkill`).

### Reusable building blocks

- **Browse drawer:** `AddSubagentDrawer` (presentational, takes `options[]`) +
  `SubagentDrawerContainer`; also `ToolSelectorPopover` ("Reference a workflow" pane).
- **Pin-a-revision picker:** `UnifiedEntityPicker` +
  `createWorkflowRevisionAdapter({flags})`
  (`web/packages/agenta-entity-ui/src/selection/adapters/workflowRevisionRelationAdapter.ts`).
- **Gallery page:** `@agenta/home-ui` `TemplateGallery`/`TemplateCard`/`TemplateDetail`
  (agent-templates route) — best model for a registry browse page.
- **Server catalog precedent:** workflow catalog endpoints
  (`api/oss/src/resources/workflows/catalog.py`, "global and read-only") and tool
  discovery (`api/oss/src/core/tools/{discovery,registry}.py`, `POST /tools/discover`)
  for search-over-external-catalog.
- **Data plumbing:** `queryWorkflows` accepts `flags`
  (`web/packages/agenta-entities/src/workflow/api/api.ts:96`); evaluators show the
  focused-list-atom pattern (`evaluatorUtils.ts`).

## Gaps (what a registry actually needs built)

### Backend

1. **Queryable skills.** `is_skill` is revision-only; the de-facto list endpoint
   `POST /simple/workflows/query` filters skills in Python *after* SQL windowing
   (`api/oss/src/core/workflows/service.py:3603-3639`) — pagination is wrong and it's
   N+1. Fix: promote `is_skill` to artifact flags (+ backfill migration) or add a
   dedicated skills list endpoint with correct SQL filtering.
2. **No search** beyond `name ILIKE`; description not searchable; no tags/categories.
3. **No cross-project scope.** All three workflow tables are `ProjectScopeDBA`
   (`project_id NOT NULL`, filtered in ~74 DAO sites); no `organization_id`, no
   visibility flag. Org-wide registry needs either org columns through the *shared*
   `GitDAO` (high blast radius) or a separate publication-records table + dedicated
   read service (keeps GitDAO untouched — preferred).
4. **No import surface.** Zero URL/GitHub fetch code; no SKILL.md *parser* in Python;
   no provenance/trust model — and `allow_executable_files` means imported skills can
   carry executables.
5. **No install/uninstall primitive.** Install = raw change-set `add_item` on
   `parameters.agent.skills` (keyed by `name` — two skills with the same name collide
   silently,; the runner keeps first and logs, but the log reaches no surface).
6. **Static catalog is release-coupled**; no tier between "code-defined global" and
   "one project's row".

### Frontend gaps

1. `@ag.embed` **writer** (builder + list insert op) — doesn't exist.
2. `is_skill` in `WorkflowQueryFlags` + a `skillsListQueryAtom`.
3. Skill create/publish path — no flags-editing UI exists anywhere; `createWorkflow`
   is the only place flags are set. "Registry by default" likely means: creating a
   standalone skill = `createWorkflow` with skill URI (no flag editing needed).
4. Browse page + sidebar entry + skill detail; picker in agent config; pin/follow UI.
5. Real ownership signal — static-skill detection is `__ag__` slug-prefix heuristics.

### SDK / runner

Mostly untouched for v1 (resolution is server-side). Later: pinning-contract cleanup
(explicit pin/track instead of reference-level inference), SKILL.md parsing for import
(belongs in the API, not the SDK), dropped-duplicate visibility (runner already dedupes keep-first; the log is stderr-only).

### UX conventions settled during mockup review (2026-09-04)

- From the registry, "Add to agent" opens a **pick-agents step inside the same drawer**
  (batch: one skill → many agents, already-added agents shown with their pins); it never
  navigates into a single agent's playground.
- **Nested drawers** (opened from another drawer: pick-agents, the editor) show a back
  chevron in the header, not a close X; page-opened drawers keep the X.
- The editor is one surface reached from both directions (detail drawer, agent skill
  row); Save from it triggers the (proposed) blast-radius save dialog.

## Open product decisions (blockers before build)

1. **Registry scope for v1:** project-scoped (cheap — it's a filtered workflow list) vs
   org-scoped (needs the publication-record architecture). Recommend project-scoped v1,
   with the publication-record table as the designed-for v2.
2. **Auto-discover semantics.** Mahmoud: "the agent can auto-discover all skills from
   the registry." Two very different builds:
   - (a) explicit install: picker adds an `@ag.embed` per skill — fits everything today;
   - (b) true auto-discovery: agent dynamically sees all registry skills without config
     entries — a new resolution concept (a "registry mount"/wildcard embed), plus
     prompt-size and permission questions.
   RESOLVED (2026-09-06, Arda): (a), and "auto-discover" = the AGENT doing the
   explicit install itself — a registry-search platform tool + the existing
   self-config ops + approvals. No resolver mount; (b) is dropped.
3. **External skills: snapshot vs live ref.** Import-as-workflow-revision (snapshot,
   re-sync on demand) vs resolving against the remote repo live. Snapshot is safer and
   fits the data model; live browse can still hit GitHub API read-only.
4. **Trust model for imports:** strip/deny executables, size budget, provenance fields.
5. **Name collisions** across registry skills installed into one agent.
6. **Inline skills migration:** auto-migrate existing inline skills to embedded on next
   commit, prompt once, or support both shapes indefinitely.

## Import-from-source pipeline (technical sketch, 2026-09-05)

Server-side, one pipeline for repo import AND folder/zip upload; nothing runs from the
repo — always snapshot.

1. **Fetch** (API, new module ~`api/oss/src/core/skills/import_service.py`): GitHub REST
   tarball (`GET /repos/{o}/{r}/tarball/{ref}`) into a temp dir — no git clone. Public
   repos v1; PAT/private later. Structural precedent: tools discovery
   (`core/tools/{discovery,registry}.py`).
2. **Detect layout**, in order: `.claude-plugin/marketplace.json` (Claude marketplace →
   enumerate plugins → their `skills/` dirs), root `SKILL.md` (single skill), else glob
   `**/SKILL.md` (multi-skill repo → the 1e recovery UX).
3. **Parse + validate**: Python needs a SKILL.md *parser* (today frontmatter is only
   composed, in the runner TS). Mirror the SDK contract
   (`sdks/python/agenta/sdk/agents/skills/models.py`): kebab name ≤64, description
   ≤1024, body ≤50k, files text-only ≤200KB each with safe relative paths. Trust gates:
   executables imported with `executable=false` + `allow_executable_files=false`;
   binaries skipped with a warning.
4. **Store as normal workflows**: per skill, `create_workflow` with the skill URI +
   `data.parameters.skill = SkillTemplate.model_dump(mode="json")` (snake_case storage shape — NOT `to_wire()`, which is the camelCase runner shape), commit revision v1 —
   `is_skill` is inferred from the URI; ordinary project-scoped git history from there.
5. **Provenance + sync**: a `skill_sources` record (project_id, repo_url, ref,
   commit_sha, last_checked) + per-skill link (source_id, path in repo, imported sha,
   content hash). "Keep in sync" = compare repo HEAD sha (periodic or on registry open);
   changed skills get a NEW revision committed — surfaced as "vN available", never
   auto-applied to pinned agents; follow-latest agents pick it up via normal embed
   resolution.
6. **Endpoints**: `POST /skills/sources/scan` (repo_url → preview: found skills,
   validity, warnings — powers the scan drawer), `POST /skills/sources` (selected paths
   → import as v1 + source record), `POST /skills/sources/{id}/refresh`. Upload reuses
   the same scan/import with an archive body instead of a URL.
7. **Collisions**: same skill name already in the registry → block with prompt or
   auto-suffix (open decision #5-adjacent).

Sync details: HEAD-sha check per source (ETag-cheap) → tarball re-parse only on change →
per-skill `content_hash` compare → new revision committed on the SAME artifact
(`sync: <repo>@<sha>`). Sync never touches agent configs: pins are inert (badge = pinned
version vs head), follow-latest resolves head at the next session. Sub-decisions:
local edit DETACHES the skill from sync ("modified locally"; explicit re-sync overwrites
as a new revision, history keeps the edit); repo-deleted skills are marked "no longer in
source", never deleted; identity tracked by path-in-repo (frontmatter rename → artifact
rename + collision check).

MVP = fetch + detect + parse + store (no sync record) ≈ days; sync adds the table + a
refresh check.

## Proposed phasing (draft)

- **Phase 0 — UX mockups + decisions** (Mahmoud's ask). Mock: registry browse page,
  skill picker inside agent config, pin/follow affordance, import-from-GitHub flow.
  Decide the 5 questions above.
- **Phase 1 — registry core (project scope).** BE: skills queryable with correct
  pagination (artifact-level `is_skill` or dedicated endpoint). FE: skills list atom,
  browse page (TemplateGallery pattern) + sidebar entry, standalone skill create
  (reusing SkillFormView/SkillUploadZone), skill picker in agent config writing
  follow-latest embeds.
- **Phase 2 — versioning UX.** Pin/follow toggle (UnifiedEntityPicker + revision
  adapter), show "newer version available", upgrade action. Consider explicit
  pin contract server-side.
- **Phase 3 — external import.** SKILL.md parser (API-side), GitHub repo import →
  snapshot as skill workflow(s), marketplace-manifest support (Claude/Codex plugin
  format), trust gates (no executables by default). Browse-before-import via GitHub
  API.
- **Phase 4 — org-wide sharing.** Publication-records table + read service bypassing
  project scope on that path only; publisher identity; in-house Agenta skills move from
  static catalog to seeded registry entries.
