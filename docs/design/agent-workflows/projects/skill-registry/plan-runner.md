# Skill registry — runner/SDK plan

Reviewed against code 2026-09-05 (Opus review); v2 incorporates the findings.
Deliberately minimal: embed resolution is server-side, and materialization
(`services/runner/src/engines/skills.ts` → `.claude/skills` / `.codex/skills` /
Pi snapshot) already handles whatever the registry resolves to.

## WP-R1 — hygiene (ship with M3)

1. **Dropped-skill visibility.** The duplicate-name overwrite bug does NOT exist —
   `resolveSkillDirs` is already keep-first with a log (`skills.ts:156, 170-176`,
   fixed 2026-06-24 in `91db4611c4c`). The real gap: that log is an unstructured
   stderr string with no path to the platform — there is no structured-log channel
   and no warnings field on `AgentRunResult` (`protocol.ts:786-805`). The one channel
   that reaches the platform is OTel, and it is already skills-aware
   (`tracing/otel.ts:1764-1772, 1076-1083` stamp `ag.meta.skills.loaded/count`).
   Scope: extend `MaterializedSkills` with `dropped: string[]`, thread through
   `run-plan.ts:680` onto the plan workspace, and stamp `ag.meta.skills.dropped`
   at BOTH emission sites — `run-turn.ts:346` AND `harness-trace-port.ts:149`.
   (A first-class `warnings[]` on `AgentRunResult` would be a wire-contract change
   with golden-fixture/contract-test blast radius — out of scope; note only.)
2. **Stale docs/comments sweep** (one pass, all files):
   - `harnesses.py:119-120` — "wiring them into Codex is a later milestone" (Codex
     is wired: `workspace.ts:57` writes `.codex/skills`).
   - `skills-config/architecture.md:89` and `:145-147` — "Claude SDK drops skills";
     while in there, fix the whole file's drift (`services/agent/`→`services/runner/`,
     `SkillConfig`→`SkillTemplate`, `_agenta.*`/`is_platform`/`PlatformWorkflowCatalog`
     → `__ag__`/`is_static`/`StaticWorkflowCatalog`).
   - `tracing/otel.ts:1502-1504` — references the removed forced-skills overlay and
     `_agenta.*` naming.
   - Add `skills` coverage to the codex golden fixture
     (`run_request.codex.json` has no skills key; claude and pi_core do) — deleting
     the harness comment removes the only artifact stating the codex contract.

## Deferred to M2 (cross-surface, NOT runner-local)

**Skill-version telemetry.** Versions are NOT available at plan-build time: the
resolver strips every revision-level field when inlining
(`api/oss/src/core/embeds/utils.py:85-94` `_revision_data_or_self` returns
`value["data"]`), `WireSkill` (`protocol.ts:263`) carries no version, and
`SkillTemplate` is `extra="forbid"` so an extra key fails parsing. Shipping this
requires: API-side provenance on the resolve response, an SDK model + `to_wire`
field, `WireSkill` + both contract tests + golden fixtures, then the two OTel
emission sites (`ag.meta.skills.versions`, do not overload `.loaded`). File it
with M2 where the API already touches resolution.

## Explicitly no change in v1

- **Reconciliation stays rebuild-first** for skill edits:
  `reconciliation-router.ts:134` (`WORKSPACE_FILES_EDITS_REBUILD = true`, applied
  `:189-216`). The in-place route is dead code today (router comment `:675`), and
  the Pi refusal lives in the applier (`apply-plan.ts:104-110`), currently
  unreachable. Nuance worth knowing: the rebuild trigger is a CONTENT hash
  (`lifecycle/desired-state.ts:142-144`), so a follow-latest bump with
  byte-identical content does not evict sessions.
- **No registry mount / wildcard auto-discovery.** Precedent exists and should be
  named when this reopens: the static catalog's `__ag__*` default-config embed is
  the "skills without picking" shape, and a forced-skills overlay (`pi_agenta`)
  existed and was deliberately removed 2026-08-29 (`agenta_builtins.py:13-15`).
- **Wire format unchanged** (`WireSkill`, `disable-model-invocation` passthrough).

## Risks to watch

1. **Session eviction = the blast-radius set.** Because skills are in the
   workspaceFiles fingerprint and rebuild is the only route, every content-changing
   skill commit evicts every live session of every follow-latest agent using it —
   exactly the set the W4 save dialog lists. The dialog should say so.
2. **Codex bundled-skill conflict.** Codex ships its own `skill-creator`/
   `skill-installer` steering the model to write into `.codex/skills`
   (`platform-guidance.ts:161-193`; benchmarked as a losing prose-vs-tool matchup).
   A registry that makes skills abundant worsens this on codex.
3. **Serial Daytona uploads.** Skill files upload one-by-one, awaited
   (`pi-assets.ts:893-922`, `workspace.ts:154-166`); an "Add all" agent pays a
   many-round-trip cold boot and rebuild. Bound per-agent skill count in UX or plan
   batching. Also `readFileSync(..., "utf-8")` (`:918`) corrupts binaries — the
   import pipeline's text-only gate is a hard requirement, not a nicety.
