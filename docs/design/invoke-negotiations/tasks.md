# Tasks — Invoke negotiations

> Ordered. Contract and rationale in [specs.md](./specs.md); audit provenance in
> `big-agents-audit/telemetry.md` (DECISION block) and
> `big-agents-audit/invoke-negotiation-traces.md`. Re-verified at `big-agents`
> HEAD `0b7cbad4f8`: zero drift in every referenced file; 61 existing
> negotiation/aggregation tests green before this work starts.

## 0. Decided (locked 2026-07-03/04 — do not relitigate)

- [x] Handler-owned resolution for `stream` / `trim` / `force`; 406 for anything a
      handler can't deliver (no courtesy aggregation anywhere).
- [x] Renames: flag `history`→`trim`, flag `control`→`force`; header
      `x-ag-messages-history`→`x-ag-messages-transcript` (no deprecation window — no
      caller sends the old names).
- [x] New headers: `x-ag-session-control: force|∅`, `x-ag-workflow-embeds: resolve|∅`.
      Header values NAME the opt-in; absent = null = default.
- [x] Defaults: `stream=false`, `trim=false` (= full), `force=false`;
      `resolve` null→**true** (the one exception; off-switch body-only);
      `format=agenta` (stays HTTP-only at routing).
- [x] `resolve` consumed AND stripped by the ResolverMiddleware — handler sees exactly
      `{stream, trim, force}`.
- [x] batch = fold(stream) via a shared fold over the agenta EVENT vocabulary (no
      runner prerequisite); `_agent_event_stream`/`_agent_batch` STAY.
- [x] `force=true` → 406 until the `inputs × force` take-over semantics land.
- [x] **Both invoke surfaces comply**: the generic root `POST /invoke` dispatch gets the
      SAME header→flag negotiation as the route mounts, via one shared endpoint-prelude
      helper (added 2026-07-04).
- [x] **`agent_v0` becomes a canonical SDK handler** registered in `HANDLER_REGISTRY`,
      akin to `llm_v0`; the agent service shrinks to composition + mount (added
      2026-07-04; feasibility verified — the service's tools/tracing layers import only
      `agenta.sdk.*`).
- [x] Out of scope: sessions command plane, `format` push-down, runner
      `result.messages` fidelity.

## 1. SDK primitives (pure functions + unit tests)

- [x] `sdks/python/agenta/sdk/agents/fold.py` (or beside the event DTOs):
      `fold(events) -> {messages, stop_reason, pending_interaction}` over the canonical
      vocabulary (`message_start/delta/end`, `thought_*`, `tool_call`, `tool_result`,
      `interaction_request`, `data`, `file`, `usage`, `error`, `done`).
- [x] `trim_to_trailing_unit(messages) -> Message[]` — last assistant message, or the
      whole trailing tool/approval run; always a list.
- [x] Unit tests: plain turn, multi-message turn, tool run, paused turn
      (`interaction_request` + `done(paused)` → `pending_interaction`), error turn,
      thought/data/file events ignored in messages but not lost from stop_reason/usage
      handling. Trim: text-tail, tool-tail, approval-tail, single-message.

## 2. Contract test first (RED)

- [x] `batch = fold(stream)` route-level contract test next to the cube: same request
      via stream then batch against `/agent/v0/invoke` (mocked harness);
      `fold(streamed events)` deep-equals batch `outputs`. Mark `xfail(strict=False)`
      until §4 lands, then flip to a hard assertion.

## 3. Flags + headers (models + routing)

- [x] `sdks/python/agenta/sdk/models/workflows.py::WorkflowInvokeRequestFlags`: rename
      `history`→`trim`, `control`→`force`; keep `stream`, `resolve`; update docstrings
      to the decided semantics.
- [x] `sdks/python/agenta/sdk/decorators/routing.py`:
  - [x] rename `_parse_history_header` → transcript parsing:
        `x-ag-messages-transcript: full|last|∅` → `trim` (last→true, full/∅→unset/false).
  - [x] add `x-ag-session-control: force|∅` → `force`.
  - [x] add `x-ag-workflow-embeds: resolve|∅` → `resolve` (∅ → leave unset; the
        middleware default is true).
  - [x] body-flag-wins precedence preserved for every axis (existing pattern,
        routing.py:552-559).
- [x] Grep-sweep: no remaining reference to `history` as a command flag or
      `x-ag-messages-history` (code, tests, docs).

## 4. Handlers

- [x] **`agent_v0` in the SDK** (specs.md §agent_v0). Lift `_agent` +
      `_agent_event_stream` + `_agent_batch` out of `services/oss/src/agent/app.py`
      into the SDK (e.g. `sdks/python/agenta/sdk/agents/handler.py`, registered as
      `agent_v0` in `engines/running/utils.py::HANDLER_REGISTRY` under
      `builtin.agent.v0`):
  - [x] composition seam with env-driven defaults: tool/MCP resolvers, secret
        provider, default template, backend selector (`AGENTA_RUNNER_INTERNAL_URL`);
        the SDK default composition makes `retrieve_handler` work in any process.
  - [x] batch shape: drain the same stream, apply `fold`, apply
        `trim_to_trailing_unit` when `trim=true`, return
        `{messages, stop_reason?, pending_interaction?}`; delete the synthetic
        single-message envelope.
  - [x] flags: reads `stream`/`trim`/`force` off `request`; `force=true` → raise the
        406-mapped error.
  - [x] `services/oss/src/agent/app.py` shrinks to composition + mount (file-default
        template, gateway tool resolver, vault secret provider, `AGENT_SCHEMAS`
        interface override) — the `managed.py` pattern.
- [x] `engines/running/handlers.py::llm_v0`: read `trim` off its existing `request`
      param — apply to its `messages` envelope (default full, honoring its documented
      contract); `force=true` → 406-mapped error; `stream` ignored (routing 406s by
      symmetry). Fix the docstring's inert `response: {"stream": false}` mention.
- [x] chat / completion / evaluators: no code change; confirm by test only.

## 4b. Dispatch-surface parity (root `POST /invoke`)

- [x] Extract the endpoint prelude from `route()`'s `invoke_endpoint`
      (`decorators/routing.py:542-585`) into a shared helper: all five header→flag
      fills, session-id extraction (body > `x-ag-session-id` > baggage), vercel input
      projection. Route endpoint calls it (behavior unchanged).
- [x] `services/entrypoints/main.py::services_invoke` calls the same helper before
      `invoke_workflow`.
- [x] Parity test: same request + header set against a route mount AND against the
      root dispatch → identical response (shape, status, headers) for a batch and a
      stream case.

## 5. Middleware removals

- [x] `middlewares/running/normalizer.py`: delete the `stream=false` drain branch
      (169-178) and the `{messages:[...]}` envelope trim (194-197); generators always
      pass through as stream responses, dicts pass through unmodified.
- [x] `middlewares/running/resolver.py`: after hydration, STRIP `resolve` from
      `request.flags` (one line near 603).

## 6. Test surface (the four levels — specs.md "Testing contract")

- [x] **Level 1 (handlers direct)**: extend
      `services/oss/tests/pytest/unit/agent/test_invoke_handler.py` to the 27-combo
      flag cube for `_agent`; add the same cube for `llm_v0` (mocked LLM call).
- [x] **Level 2 (`@workflow` programmatic)**: rewrite
      `test_workflow_aggregation_running.py` (incl. stale "RED today" docstring) into
      the passthrough + resolve-strip assertions; request-taking vs flag-blind handler.
- [x] **Level 3 (`@instrument` invariance)**: extend the invariance sweep
      (`test_workflow_instrument_programmatic.py`,
      `test_routed_trace_invariant_across_format_and_history`) from 3 axes to 5
      (stream × format × transcript × control × embeds); span tree + accumulated
      outputs identical across all combinations.
- [x] **Level 4 (`@route`)**:
  - [x] header-semantics sweep per axis + body-wins precedence (new headers included).
  - [x] negotiation cube against REAL `/agent/v0/invoke` and `/llm/v0/invoke` mounts
        (stream × transcript × format).
  - [x] 406 matrix: batch-only × stream Accept; stream-only (flag-blind generator) ×
        JSON Accept; `force` header/flag on both real handlers.
  - [x] flip the courtesy-aggregation pins to 406 assertions
        (`test_workflow_negotiation_cube_routing.py`,
        `test_invoke_route_aggregation_routing.py`).
- [x] Flip the §2 contract test from xfail to hard.
- [ ] Acceptance (live backend, when Step-1/2 of the telemetry runbook runs):
      update `test_routed_agent_messages_batch_trace` to the folded turn.

## Dispatch plan — subagent execution (waves; Sonnet 5 workers)

Single repo (`application/`, branch off `big-agents` before any commit — plain git, not
GitButler workspace mode). Parallel agents within a wave touch DISJOINT paths; use
worktree isolation if a wave's partition is unclear. Every brief must include: the path
to [specs.md](./specs.md) (the contract is there, not in the brief), the task-group
text verbatim, the file anchors, and the verification harness below. Workers report
diffs + test results; the orchestrator reviews between waves.

**Verification harness (canonical, from repo root; `-aiu` = acceptance+integration+unit):**

```sh
load-env hosting/docker-compose/ee/.env.ee.dev

py-run-tests --sdk -aiu
py-run-tests --api -aiu
py-run-tests --services -aiu

ts-run-tests --runner -aiu
ts-run-tests --web -iu
```

`py-run-tests`/`ts-run-tests`/`load-env` are shell functions from the user profile
(available in agent shells). During a wave, workers iterate with scoped pytest for
speed (`cd sdks/python && uv run --no-sync python -m pytest <files> -q`) and run their
area's `-iu` layers before reporting; the `-a` acceptance layers need the live EE dev
stack up (`load-env` + `run.sh --ee --dev`, see root `AGENTS.md`) and run at wave
boundaries and in Wave 4 (the full harness above). `ruff format && ruff check --fix`
in the touched Python area before done.

- **Wave 1 (2 agents, parallel — disjoint):**
  - *W1-A: primitives* — §1 fold + trim + unit tests, §2 contract test (xfail RED).
    Paths: `sdks/python/agenta/sdk/agents/` (new module) + new test files only.
  - *W1-B: flags + headers* — §3 renames + two new headers + header parsing + sweep.
    Paths: `sdks/python/agenta/sdk/models/workflows.py`,
    `sdks/python/agenta/sdk/decorators/routing.py` + their existing tests (expect
    temporary breakage in tests that use `history` — fix names only, no behavior).
- **Wave 2 (2 agents, parallel after wave 1 merges — disjoint):**
  - *W2-C: agent_v0 lift* — §4 (SDK handler + composition seam + fold/trim/force
    wiring + service thinning). Paths: `sdks/python/agenta/sdk/agents/`,
    `engines/running/utils.py` (registry), `services/oss/src/agent/app.py`,
    plus `llm_v0` flag handling in `engines/running/handlers.py`.
  - *W2-D: edge + middleware* — §5 (normalizer drain/trim removal, resolver strip) +
    §4b (shared prelude helper + `services_invoke` parity). Paths:
    `middlewares/running/{normalizer,resolver}.py`, `decorators/routing.py` (prelude
    extraction only — coordinate: W1-B owns header parsing, W2-D only MOVES it),
    `services/entrypoints/main.py`.
- **Wave 3 (up to 4 agents, parallel — one per test level, disjoint test files):**
  §6: L1 handlers-direct cube; L2 workflow-programmatic rewrite; L3 instrument
  5-axis invariance; L4 route sweeps + real-handler cube + 406 matrix + dispatch
  parity + flip the aggregation pins + flip §2 contract test to hard.
- **Wave 4 (1 agent):** §7 — full suites (sdk + services + api), caller verification,
  audit-doc closeouts, PR prep per `write-pr-description`.

Sequencing rationale: wave 2 needs wave 1's fold + flag names; wave 3 needs wave 2's
behavior; the RED contract test from wave 1 is the cross-wave progress signal (it must
flip naturally by end of wave 2).

## 7. Callers + docs

- [x] Web: no change required (only `x-ag-messages-format: vercel` is sent —
      `agentRequest.ts`, `AgentChatSlice/assets/transport.ts`); verify the playground
      still renders the richer batch envelope where it consumes batch results
      (agent-as-tool / evals are opaque-blob, verified).
- [x] Update `big-agents-audit/telemetry.md` Step 4 (unblock: shapes now decided) and
      `invoke-negotiation-traces.md` findings that this work closes (F-NEG-3 llm_v0,
      F-NEG-4 history-two-meanings, the coverage gaps).
- [ ] PR per `write-pr-description` skill; reference the DECISION block.
