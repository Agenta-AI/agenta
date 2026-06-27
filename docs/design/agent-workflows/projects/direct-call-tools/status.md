# Status

Last updated: 2026-06-27

## Where this is

DESIGN deliverable on draft PR #4886 for Mahmoud's review. **Round-2 comments addressed (second
version)** — the per-comment summary is in the PR comment. No code in this project; implementation
is dispatched by the orchestrator once the design is approved.

`design.md` (the `call` descriptor, the per-tool-type table, the dispatch algorithm) and
`plan.md` (the phases) are the spec the implementation subagent would follow. Phase 1's wire
field lands on `CallbackToolSpec` in the shared `models.py` (B's active file), so implementation
is sequenced after Workstream B.

## Workstream B is active in parallel

Mahmoud started a separate agent on Workstream B (drop the `@ag.reference` marker, keep
`type:"reference"`, rebuild FE #4877 on the tool type, hide embed in the UI, add env/variant to
the reference schema) on PRs #4860 / #4877.

**Shared file: `sdks/python/agenta/sdk/agents/tools/models.py`.** B edits `ReferenceToolConfig`
(adds env/variant) and removes `AG_REFERENCE_MARKER`. A adds the optional `call` field to
`CallbackToolSpec`. Different classes, same file. Per the coordination contract (first-committer
owns a shared file), A waits for B's models.py to commit, then adds `call` on top of B's version
rather than editing concurrently. Until then A does not touch models.py.

## Decided

- **2026-06-27 — env resolution timing.** Always bake the resolved revision at resolve time,
  including `environment` references. The service is always in front of the sidecar and
  re-resolves on each invoke, so the baked revision stays current. No call-time env resolution.
- **2026-06-27 (round 2) — Mahmoud aligned with all design decisions.** Merge order and commit
  organization are the orchestrator's call; the only requirement is reviewability before merge.
- **2026-06-27 (round 2) — schema sourcing.** Platform-tool input schemas come from the in-process
  `CATALOG_TYPES` catalog (via `x-ag-type-ref`), not `/openapi.json` (fixed the doc inconsistency
  CodeRabbit flagged).
- **2026-06-27 (round 2) — reference input schema.** Taken from the referenced workflow's
  `revision.schemas.inputs` (via `/inspect`); chat carries `messages` via `x-ag-type-ref`.
- **2026-06-27 (round 2) — no tool output schema on the wire now.** Harness tool defs are
  input-only; the workflow's `schemas.outputs` stays available for a later pass.
- **2026-06-27 (round 2) — permissions uniform across all tool types** (not special-cased on the
  `call` path); a typed permissions-config hierarchy is a future refactor, out of scope.
- **2026-06-27 (round 2) — catalog to mirror.** The reserved `tools.agenta.*` pattern (PR #4884
  `find_capabilities`) + the evaluators catalog shape, not `platform_catalog.py` wholesale.

## Sequencing (orchestrator's call)

Mahmoud is aligned with all design decisions; the items below are sequencing for the orchestrator,
not decisions Mahmoud owes.

1. **When to remove the `/tools/call` `workflow.*` routing.** Coupled to "reference goes direct"
   (Phase 4) and depends on B having landed. Recommendation: in Workstream A, after B.
2. **Trace-context forwarding to the sub-workflow on a reference invoke** (Phase 6, stretch).
   Likely deferred past the first cut.

## Next step

- Round-2 review addressed; second version on PR #4886 awaiting Mahmoud's skim.
- After approval, the orchestrator dispatches the implementation per the phases in `plan.md`
  (Phase 1's `call` field on `models.py` sequenced after Workstream B).

## Board

Row claimed on `scratch/agent-coordination.md` (2026-06-27, `direct-call-tools (A)`). No `but`
write yet; BUT-LOCK left FREE; board/plan edits left unassigned.
