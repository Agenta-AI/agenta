# Status

**State: implementation starting.** Date: 2026-07-04. Phase 0 (reconcile plan with the
post-merge tree) done; the slice plan in [plan.md](plan.md) is reconciled against
big-agents after #5041, #5064, #5059, #5047. Citation drift ledger:
[research.md](research.md), "2026-07-04 reconciliation".

2026-07-04: JP's #5064 landed (invoke negotiation; batch = fold(stream), full
transcript). test_run digest simplified accordingly in api-design.md; silent-fallback
(#5002) still open; resolved still trace-only.

2026-07-04: Mahmoud's review round 1 on PR #5060 folded in. Gateway semantics corrected
(gateway = runs through the Agenta gateway, Agenta actions included by design; rename
proposed), Option B rejected, A'-vs-C field-level comparison added, the overlay now
carries only the playbook skill.

2026-07-04 (later): #5041 (approval-boundary) MERGED. `op_catalog.py` is no longer
contended; approval for new ops is expressed by the `read_only` hint under the merged
permission plan (write + no explicit permission → ask). The coordination constraint
moved from `op_catalog.py` to the runner/wire surface; see plan.md.

## Decided (do not relitigate)

1. Hard-migrate renames, no aliases: `find_capabilities` -> `discover_tools`,
   `find_triggers` -> `discover_triggers` (Mahmoud, 2026-07-03).
2. Cut from the default overlay, keep in catalog: `pause_schedule`, `resume_schedule`,
   `pause_subscription`, `resume_subscription`, `query_workflows`, `list_connections`,
   `list_subscriptions` (see [research.md](research.md) gotcha 6).
3. Keep `test_subscription` (Mahmoud, 2026-07-03).
4. One PR for all code changes, on one GitButler lane; slices as commits.
5. No business logic in the runner; the runner just runs the agents. Option B is closed
   (Mahmoud, 2026-07-04).
6. "Gateway" means "runs through the Agenta gateway"; Agenta-implemented actions belong
   on that plane by design (Mahmoud, 2026-07-04). The rename of the term is proposed, not
   decided: see [tool-home-options.md](tool-home-options.md), rename proposal — now
   slice 6 (rename-or-defer, decided at PR review).
7. **Option C confirmed (Mahmoud, 2026-07-04)**: `test_run` and future logic-bearing
   internal tools are declared from the platform catalog via a `handler` mode and run
   as server-side handlers on the tool-call plane, with generic relay `$ctx` injection
   on `callRef` specs.

## Provisional defaults (proceeding; flagged for PR review, not relitigated in-flight)

| Call | Default in effect | Where argued |
|---|---|---|
| overlay-scope | **Static 13** (8 core + 5 event, seven ops cut); conditionality deferred | [research.md](research.md#overlay-scope) |
| test-run-shape | **Sync + delta**, 120s cap, per-op `timeout_ms` plumbing; `test_id` reserved so an async pair stays additive | [api-design.md](api-design.md#shape-decision) |
| spans-stopgap | **Ship `query_spans` now** (slice 3); pure data add, still useful after `test_run` for reading scheduled fires | [api-design.md](api-design.md#the-query_spans-stopgap) |

## Coordination (current, post-#5041)

- **`op_catalog.py` is FREE.** The approval-boundary lane merged and archived; the file
  is identical to the workspace base. Post a board row before editing anyway.
- **The runner/wire surface is contended** (slice 5 + slice 1's docs sweep): the applied
  `feat/claude-client-tools-recut` lane owns `relay.ts` / `protocol.ts` / `responder.ts`
  / `spec-schema.ts` + fresh `documentation/tools.md` and interface-page edits; a
  second session's UNCOMMITTED pi-builtin-gating WIP sits on `relay.ts` /
  `permission-plan.ts` / `responder.ts` / `sandbox_agent.ts`. Sequence per plan.md
  coordination constraint 2 (lease, wait for the WIP to land, expect hunk-locking).
- `docs/agent-skill-packaging` lane overlaps slice 4 in subject (docs-only); sync
  direction before finalizing the playbook body.

## To verify live before the PR leans on it

- Gotcha 1: whether a fresh playground run actually resolves only the getting-started
  skill (the other three authoring skills appear undelivered; evidence in
  [research.md](research.md) gotcha 1). Feed the result back to
  builder-agent-reliability either way.

## Folder

- [README.md](README.md) - index.
- [context.md](context.md) - why, goals, non-goals, decisions.
- [research.md](research.md) - executor architecture, rename/cut inventory, gotchas,
  2026-07-04 reconciliation ledger.
- [tool-home-options.md](tool-home-options.md) - the four homes; Option C confirmed.
- [api-design.md](api-design.md) - `test_run` contract + `query_spans` stopgap.
- [skills-port.md](skills-port.md) - the playbook skill.
- [plan.md](plan.md) - slices, coordination, tests-and-docs discipline.

## Slice 1 Deferred Touch-Points

2026-07-04: Slice 1 code sweep intentionally did not edit the docs/interface and FE surfaces
owned by other lanes. Deferred old-op references remain in:

- `docs/design/agent-workflows/documentation/tools.md`
- `docs/design/agent-workflows/interfaces/README.md`
- `docs/design/agent-workflows/interfaces/cross-service/runner-to-tool-callback.md`
- `docs/design/agent-workflows/interfaces/in-service/tool-models-and-resolution.md`
- `docs/design/agent-workflows/interfaces/public-edge/agent-config-schema.md`
- `web/packages/agenta-playground/tests/unit/agentRequest.test.ts` (5 op fixture literals)
- generated-client docstrings: `web/packages/agenta-api-client/src/generated/api/types/CapabilitiesResult.ts` and `clients/python/agenta_client/types/capabilities_result.py` (fixed at next codegen)
