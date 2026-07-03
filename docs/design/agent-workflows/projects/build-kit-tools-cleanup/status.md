# Status

**State: design docs written, awaiting Mahmoud's review.** Date: 2026-07-03. No code
changed. Deliverable of this round: this workspace.

## Decided (do not relitigate)

1. Hard-migrate renames, no aliases: `find_capabilities` -> `discover_tools`,
   `find_triggers` -> `discover_triggers` (Mahmoud, 2026-07-03).
2. Cut from the default overlay, keep in catalog: `pause_schedule`, `resume_schedule`,
   `pause_subscription`, `resume_subscription`, `query_workflows`, `list_connections`,
   `list_subscriptions` (recommended: cut it from the overlay, keep the op; see
   [research.md](research.md) gotcha 6).
3. Keep `test_subscription` (Mahmoud, 2026-07-03).
4. One PR for all code changes; docs only until the plan is approved.

## Open (Mahmoud answers; recommendations written)

| Decision | Recommendation | Where |
|---|---|---|
| overlay-scope: static 12-13 vs conditional event pack | Static 13 now; conditionality needs machinery that does not exist (`build_agent_template_overlay()` takes no request context) and adds a new failure mode | [research.md](research.md#overlay-scope) |
| test-run-shape: sync+delta vs committed-only vs async pair | Sync + delta with a duration cap and per-op timeout plumbing; `test_id` reserved so the async pair is an additive fallback | [api-design.md](api-design.md#shape-decision) |
| spans-stopgap: ship `query_spans` now vs hold for `test_run` | Ship now (slice 3); pure data add, independent of the home decision, still useful after `test_run` for reading scheduled fires | [api-design.md](api-design.md#the-query_spans-stopgap) |

Plus the headline question this workspace exists to settle:

| Question | Recommendation | Where |
|---|---|---|
| Where do logic-bearing internal tools live? | **Option C**: server-side handlers on the existing tool-call plane, registered through the catalog (`handler` mode), with generic `$ctx` injection added to the relay's `callRef` branch. Rejects the composite resource endpoint, keeps the runner dumb, keeps credentials on the `sign_secret_token` pattern | [tool-home-options.md](tool-home-options.md) |

## Blocked on coordination

- **`op_catalog.py` is contended.** The approval-boundary lane is implementing against
  it today (permission model rework). This project's edits to that file (two key renames;
  the `handler` mode) sequence AFTER their lane lands or with the owner's explicit ack,
  via `docs/design/agent-workflows/scratch/agent-coordination.md`. No approval-semantics
  change of any kind from this project. Details: [plan.md](plan.md), coordination
  constraint.
- The slice-5 wire change (`context` next to `callRef`, per-op `timeout_ms`) touches
  `protocol.ts`/`wire.py`/golden fixtures; check the board for runner leases before
  starting.

## To verify live before implementation

- Gotcha 1: whether a fresh playground run actually resolves only the getting-started
  skill (the other three authoring skills appear undelivered; evidence in
  [research.md](research.md) gotcha 1). Feed the result back to
  builder-agent-reliability either way.

## Folder

- [README.md](README.md) - index.
- [context.md](context.md) - why, goals, non-goals, decisions.
- [research.md](research.md) - executor architecture, rename/cut inventory, gotchas.
- [tool-home-options.md](tool-home-options.md) - the four homes, recommendation.
- [api-design.md](api-design.md) - `test_run` contract + `query_spans` stopgap.
- [skills-port.md](skills-port.md) - the playbook skill.
- [plan.md](plan.md) - slices, coordination, tests-and-docs discipline.
