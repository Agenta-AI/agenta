# Status

**State: landed (server half).** Date: 2026-07-04. Slices 1-5a are committed on the
GitButler lane `feat/build-kit-tools-cleanup` (4 commits, `a8a7a1e170..61cf1751b9`), with
tests green (api changed-domain suites 250 passed; sdk unit 1596 passed) and the docs sweep
folded in. Slice 5b (the runner half of `test_run`) and slice 6 (the `gateway` -> `server`
rename) are deferred; see the open-issues entries below.

## Shipped (slices 1-5a)

1. **Renames, hard.** `find_capabilities` -> `discover_tools`, `find_triggers` ->
   `discover_triggers`, no aliases. The legacy reserved `/tools/call`
   `tools.agenta.find_capabilities` route is deleted. Dev-DB revision sweep script at
   [scripts/sweep_platform_op_renames.py](scripts/sweep_platform_op_renames.py).
2. **Overlay cut.** Explicit `DEFAULT_BUILD_KIT_OPS` (12 ops) plus the
   `request_connection` client tool. Cut from the default (still catalog opt-ins):
   pause/resume x4, `query_workflows`, `list_connections`, `list_subscriptions`.
3. **`query_spans`.** New read op over `POST /api/spans/query`; schema mirrors
   `SpansQueryRequest`, pinned by a drift contract test.
4. **One playbook skill.** `build-an-agent` (slug `__ag__build_an_agent`) replaces
   build-your-first-app + discover-and-wire-tools + set-up-triggers. The overlay embeds
   ONLY the playbook; `getting-started` stays harness-forced, so it is no longer
   double-delivered.
5. **`test_run`, server half.** `PlatformOp` handler mode (`method`+`path` XOR `handler`),
   resolver emits `callRef` + `contextBindings` + `timeoutMs` specs flag-gated OFF
   (`AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`), `/tools/call` reserved-registry dispatch, and
   the tools-domain composite handler (delta requires `EDIT_WORKFLOWS`, recursion marker
   inert until 5b, 120s ceiling, terminal-result-wins verdict). NOT in the overlay yet.
   Plus an SDK resolver fix: inline parameters-less revisions now seed the default
   template, aligning the inline and reference paths (found live: a fresh playground app's
   committed revision broke `test_run`'s child invoke).

## Deferred

- **Slice 5b** (runner `callRef` dispatch + spec-level context injection + `timeoutMs` +
  overlay flip + flag default-on): see the open-issues entry
  "[Land the runner half of test_run](../../scratch/open-issues.md)".
- **Slice 6** (`gateway` -> `server` rename; Codex review scoped it to docs/UI labels):
  see the open-issues entry "[Decide and execute the gateway -> server rename](../../scratch/open-issues.md)".
- FE fixture sweep (`agentRequest.test.ts` op literals) and generated-client docstrings:
  fixed at next codegen; noted in the PR.

Earlier reconcile notes (Phase 0 against #5041, #5064, #5059, #5047): citation drift
ledger in [research.md](research.md), "2026-07-04 reconciliation".

2026-07-04: JP's #5064 landed (invoke negotiation; batch = fold(stream), full
transcript). test_run digest simplified accordingly in api-design.md; silent-fallback
(#5002) still open; resolved still trace-only.

2026-07-04: Mahmoud's review round 1 on PR #5060 folded in. Gateway semantics corrected
(gateway = runs through the Agenta gateway, Agenta actions included by design; rename
proposed), Option B rejected, A'-vs-C field-level comparison added, the overlay now
carries only the playbook skill.

2026-07-04 (slice 5a review fix): Recorded the 5a -> 5b contract in
api-design.md. 5a leaves recursion header propagation, child cancellation and
`trace_id` on timeout, runner `timeoutMs` honoring, and default-on
`AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS` to 5b.

2026-07-04 (later): #5041 (approval-boundary) MERGED. `op_catalog.py` is no longer
contended; approval for new ops is expressed by the `read_only` hint under the merged
permission plan (write + no explicit permission → ask). The coordination constraint
moved from `op_catalog.py` to the runner/wire surface; see plan.md.

2026-07-05: Slice 5b PLANNED at [plan-5b.md](plan-5b.md). Contention re-checked: the
runner surface is FREE (`claude-client-tools-recut` and pi-builtin-gating #5066 are
merged; no lane or WIP owns `services/runner/`). Key code-truth corrections vs the old
contract text: the SDK already emits `contextBindings`/`timeoutMs` (5a), so 5b's wire
work is protocol.ts + goldens + run-kind only; the CHILD relay poll deadline (60s,
`dispatch.ts:87`) must honor `timeoutMs` too, not just the host fetch; and the flip
must change the flag's off-semantics from raise to skip, or the kill switch bricks
every default build-kit agent once `test_run` joins `DEFAULT_BUILD_KIT_OPS`. Six
slices on one lane, one PR; live-debug matrix per debug-local-deployment.

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

- Gotcha 1: OVERTAKEN by slice 4. The three authoring skills are deleted; the overlay
  embeds only the playbook and getting-started is harness-forced, so the double-delivery
  question no longer applies. Live verification (2026-07-04) confirmed a fresh playground
  agent resolves getting-started (forced) + the playbook (overlay).

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

2026-07-04 (Phase 5 docs sweep): the five docs/interface pages are now updated in this
lane (`documentation/tools.md`, `interfaces/README.md`,
`cross-service/runner-to-tool-callback.md`, `in-service/tool-models-and-resolution.md`,
`public-edge/agent-config-schema.md`, plus `documentation/agent-configuration.md` for the
skills story). Still deferred:

- `web/packages/agenta-playground/tests/unit/agentRequest.test.ts` (5 op fixture literals)
- generated-client docstrings: `web/packages/agenta-api-client/src/generated/api/types/CapabilitiesResult.ts` and `clients/python/agenta_client/types/capabilities_result.py` (fixed at next codegen)

## Deferred / follow-ups
- Live gap (environment-flavored): child invokes through the local in-process -> sub-sidecar path return trace_id=None (sidecar persist/heartbeat 401s), leaving test_run's resolved/span digest empty on this path; follow up on the tracing link, not a build-kit code bug (2026-07-04 live verify).
