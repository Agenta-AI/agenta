# Skill registry — master technical plan

Status: planned 2026-09-05, after mockup review. Companions:
[discovery.md](./discovery.md) (codebase map), [ux-plan.md](./ux-plan.md) (surfaces and
conventions), and the per-surface plans this document indexes:

- [plan-api.md](./plan-api.md) — backend (workflows domain, import service, usage query)
- [plan-runner.md](./plan-runner.md) — runner/SDK (minimal for v1)
- [plan-web.md](./plan-web.md) — frontend (`@agenta/skills`, `@agenta/skills-ui`, host wiring)

Mockups: <https://claude.ai/code/artifact/c8901092-a2b1-46dd-9b2d-6cde83cec201>

## Architecture in one paragraph

A skill is already a workflow revision (`data.parameters.skill`, revision flag
`is_skill`), and pin-vs-follow already falls out of the embed reference level
(artifact ref = follow latest, revision ref + version = pinned). The registry is
therefore mostly *exposure*: make skills queryable at the artifact level, give the FE
an embed writer and dedicated skills state, build the unified skill drawer and registry
page, add a server-side import pipeline (snapshot-only) and a reverse-usage query for
the blast-radius save dialog. The runner is untouched for v1.

## Work packages and dependencies

Each WP in one plain sentence, so this table reads standalone:

| WP | In plain words | Surface | Depends on |
|---|---|---|---|
| A0 | Decide HOW skills become listable: reuse the existing `is_snippet` artifact flag, or build a new "flag lives on both artifact and revision" mechanism for `is_skill` (the flag system is a strict either-or partition today, with a test defending it) | api | — (a decision, do first) |
| A1 | Make "give me all skills in this project" a correct, paginated database query (today skills are filtered in Python AFTER pagination, so pages are wrong) + backfill existing rows | api | A0 |
| A2 | The registry-list endpoint the Skills page calls: DB skills + Agenta built-ins (as a separate block), name/description search | api | A1 |
| A3 | "Which agents use this skill?" — the reverse lookup powering the USED-BY chips and the save dialog's blast radius | api | — |
| A4 | A Python parser for SKILL.md folders (frontmatter, files, size/path rules) — today one only exists in TypeScript in the browser | api | — |
| A5 | The import machinery: fetch a GitHub repo/marketplace, scan it, create the selected skills in the registry; plus the two DB tables remembering where a skill came from | api | A4 |
| A6 | "Keep in sync": check the repo for changes and commit new skill versions, without ever touching agents; detach a skill from sync when someone edits it locally | api | A5 |
| R1 | Runner housekeeping: make dropped duplicate skills visible in tracing, sweep four stale docs/comments (the "duplicate overwrite bug" turned out to be already fixed) | runner | — |
| W0 | Bootstrap the two new frontend packages: six allowlist registrations (oss/ee/mobile/storybook configs) + dev-container restart | web | — |
| W1 | `@agenta/skills` package: schemas, API calls, list/detail state atoms, and the embed writer (the code that actually inserts a skill reference into an agent config — doesn't exist anywhere today) | web | W0; A2 for real data |
| W2 | `@agenta/skills-ui` package: the one drawer shell (detail/edit/create/upload modes, versions rail), registry gallery, picker, pick-agents step, save dialog, import drawer | web | W1 |
| W3 | Wiring it into the apps: /skills route (+ EE stub), sidebar entry, and reworking the agent config so embed-ref skill rows open the drawer instead of raw JSON — on desktop AND /m | web | W2 |
| W4 | The blast-radius save dialog on SKILL commits (which agents get this, who's pinned, whose sessions restart) — scoped so it does NOT touch the agent's auto-commit | web | A3, W2 |
| W5 | Import/upload UI wiring: repo scan drawer, invalid-upload recovery, sync badges | web | A5, W2 |

Critical path: **A0 → A1 → A2 → W1 → W2 → W3** (W0 parallel at the start).
A3/A4/A5 parallelize behind it. Per review: A1 is the riskiest API item, not the
cheapest — the A0 decision must land before any A-row code.

## Milestones

1. **M1 Registry core** (A0, A1, A2, W0, W1, W2-partial, W3): Skills sidebar entry + registry
   page listing project/built-in skills; detail drawer read-only with versions rail;
   create (write) + picker in agent config writing follow-latest embeds. Ships value
   alone.
2. **M2 Versioning UX** (A3, W4, rest of W2): pin via Add-caret, version navigation,
   used-by chips, blast-radius save dialog replacing silent auto-commit for skills.
3. **M3 Import + agent discovery** (A4, A5, W5, R1): upload pipeline server-side,
   repo/marketplace import, invalid-upload recovery; the `search_registry_skills`
   platform tool (thin wrapper over A2's head-revision query) so agents can find
   and self-install skills through the existing config ops + approval flow.
4. **M4 Sync** (A6): source records, "vN available" nudges, detach-on-local-edit.

Out of scope (deliberately): org-wide sharing (publication records — discovery.md §4),
resolver-side registry mounts (superseded: "auto-discovery" = agent-driven install
via a registry-search platform tool + existing self-config ops, see M3), private
repos.

## Cross-cutting rules

- Reuse over duplication: every UI element maps to an existing component
  (ux-plan.md §Component mapping); extract from `oss`/`entity-ui` and extend via
  props, never fork.
- All new FE API calls go through the Fern client (regenerate after A-endpoints land);
  zod validation at the boundary.
- Migrations are forward-only; the A1 backfill follows the
  `oss000000010_backfill_workflow_revision_flags` precedent.
- Every `@agenta/skills-ui` surface gets Storybook stories covering the states a
  reviewer cannot reach by clicking (empty, error, read-only, older-revision).
- PR bases: the open release branch, per repo convention.

## Test strategy

- API: pytest per WP (flags query correctness incl. pagination; parser fixtures =
  the 1c/1d/1e cases: clean, nested-multi, no-root, oversized; usage query; import
  end-to-end against a fixture tarball — no live GitHub in CI).
- Web: package unit tests (`tests/unit/`) for atoms + embed writer; Storybook build as
  the component gate; one Playwright-style smoke on the registry page if the harness
  allows.
- Manual: the clickable prototype is the acceptance script — each artboard maps to a
  QA step.

## Open decisions (unchanged from ux-plan.md)

Inline-skill migration; name-collision policy; whether non-skill config sections also
leave silent auto-commit.
