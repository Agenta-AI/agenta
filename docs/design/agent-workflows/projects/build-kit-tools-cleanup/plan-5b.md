# Plan 5b: the runner half of `test_run`

Status: planned, 2026-07-05. Slice 5a is merged (big-agents `1756d3d838`, PR #5068).
This plan lands the runner half on ONE GitButler lane as ONE PR, in commit-sized
slices. Contract source: [api-design.md](api-design.md) "5a shipped / 5b contract";
the open-issues entry "Land the runner half of test_run (slice 5b)"
(`docs/design/agent-workflows/scratch/open-issues.md:216`).

All citations below verified against the working tree on 2026-07-05 (post-#5066
pi-builtin-gating, post-#5068 slice 5a, post claude-client-tools-recut).

## Contention verdict: the runner surface is FREE

- `git status --porcelain -- services/runner/` is clean. No unassigned changes touch
  `services/runner/` (the unassigned set is docs/scratch plus one SDK test).
- `feat/claude-client-tools-recut` is an ancestor of `origin/big-agents` (merged; the
  runner commits `e69310fdd2..618764edae` are on big-agents). The pi-builtin-gating WIP
  that blocked 5a is merged as #5066 (`85120747b2..8d1b836ca1`).
- No applied lane owns `services/runner/` files. Two applied lanes own NEARBY files —
  plan around them, do not touch their files:
  - `feat/mcp-default-on-recut` (`2263b059ff`) owns
    `services/oss/src/agent/tools/resolver.py` +
    `services/oss/tests/pytest/unit/agent/tools/test_resolution.py`. Slice 3 edits
    `app.py` (disjoint), and adds a NEW test file rather than editing shared ones.
  - `feat/pi-openai-codex-capability` (`834636ae53`) owns
    `services/oss/tests/pytest/unit/agent/test_invoke_handler.py`. Same rule: new test
    file, not that one.
- Take the board BUT-LOCK before any `but` writes and post a row on
  `docs/design/agent-workflows/scratch/agent-coordination.md` when starting.

## Code truth (what exists NOW, corrected against the merged tree)

**The SDK half is already emitted.** Slice 5a shipped more of the wire than the old
contract text implies:

- The resolver emits handler-mode specs with `call_ref="tools.agenta.test_run"` +
  `context_bindings` + `timeout_ms`
  (`sdks/python/agenta/sdk/agents/platform/platform_tools.py:86-114`; catalog entry
  `op_catalog.py:942-950`, `timeout_ms=120000`,
  `context_bindings={"target.workflow_variant_id": "$ctx.workflow.variant.id"}`).
  Flag-gated: a configured handler-mode op RAISES when
  `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS` is off (`platform_tools.py:86-93`).
- The spec model already carries + serializes the fields with the camelCase aliases
  (`sdks/python/agenta/sdk/agents/tools/models.py:368-376`, `to_wire` at `:308-316`
  dumps `by_alias`), and the schema-source wire models already pin them
  (`sdks/python/agenta/sdk/agents/wire_models.py:257-260`).
- So the Python wire side needs only the `run_kind` addition; `contextBindings` /
  `timeoutMs` need golden + TS-side work, not SDK emission work.

**The runner ignores all three today:**

- `protocol.ts` `ResolvedToolSpec` (`services/runner/src/protocol.ts:104-140`) has
  `callRef` and `call` but NO `contextBindings` / `timeoutMs`. `RunContext`
  (`protocol.ts:174-185`) has `workflow` + `trace`, no run-kind group.
- A `callRef` spec dispatches through the gateway fallback:
  `relay.ts` `executeAllowedRelayedTool` → `callAgentaTool` posts `function.name =
  spec.callRef` to `/tools/call` (`services/runner/src/tools/relay.ts:296-303`,
  `callback.ts:52-64`). Args go verbatim; nothing injects bindings; the 5a server
  reserved-registry dispatch (`api/oss/src/apis/fastapi/tools/router.py:1099-1101`)
  therefore receives calls missing `target.workflow_variant_id`.
- The permission verdict fires BEFORE execution, structurally:
  `executeRelayedTool` decides (`relay.ts:239-262`; deny returns, ask pauses via
  `onPendingApproval`) and only then calls `executeAllowedRelayedTool`
  (`relay.ts:264`). For Claude, `permissions.enforce` is false (`relay.ts:118-121`)
  because the harness raises its own gates first; execution still funnels through
  `executeAllowedRelayedTool`. Injection placed inside the `callRef` branch of
  `executeAllowedRelayedTool` is therefore after-verdict by construction on BOTH
  harnesses. On resume-after-approval, the harness re-issues the call and the stored
  decision allows it through the SAME path (`permission-plan.ts:138-151`), so the
  approved execution also gets the injection.
- Timeouts today: host `/tools/call` fetch aborts at `TOOL_CALL_TIMEOUT_MS` = 30s
  (`callback.ts:15-17,42`); the CHILD-side file-relay poll gives up at
  `RELAY_TIMEOUT_MS` = 60s (`dispatch.ts:87`, `relay.ts:60-62`). Both are below the
  120s the server handler runs to (`platform_handlers.py:132`).
- `$ctx` machinery to reuse: `resolveCtxToken` / `deepSet` / `deepDelete` /
  `isPlainObject` in `services/runner/src/tools/direct.ts:129-147,52-93` — the
  fail-closed binding precedent is `assembleBody` step 3 (`direct.ts:226-237`).
- Both live delivery paths relay every custom-tool execution to the HOST relay loop:
  Pi via the extension (`extensions/agenta.ts:241-279`, requires
  `AGENTA_AGENT_TOOLS_RELAY_DIR`) and Claude via the internal MCP channel
  (`tool-mcp-http.ts:206-213`, always passes `relayDir`). The host loop is
  `startToolRelay` (`relay.ts:399-495`), wired with `request.runContext` at
  `engines/sandbox_agent.ts:838-847`. The `dispatch.ts` non-relay direct-POST branch
  (`dispatch.ts:260-267`) is unreachable in live paths — keep bindings OUT of it (the
  child must never hold private spec fields; `public-spec.ts` strips them).
- Public specs the child sees: `AdvertisedToolSpec`
  (`services/runner/src/tools/public-spec.ts:11-17`) — no `timeoutMs` today, and the
  env is filled from `advertisedToolSpecs` at
  `engines/sandbox_agent/pi-assets.ts:60-66`.

**run_kind path:** the 5a handler stamps `meta["run_kind"] = "test"` on the child
invoke and refuses requests carrying `x-agenta-run-kind: test`
(`api/oss/src/core/tools/platform_handlers.py:71-72,101-104,118-121`). The agent
service's handler receives that as `request.meta` (`WorkflowServiceRequest` =
`WorkflowInvokeRequest` extends the `Metadata` mixin with `meta`,
`sdks/python/agenta/sdk/models/workflows.py:245,285-290`,
`models/shared.py:155-158`), but `_agent`
(`services/oss/src/agent/app.py:207-278`) never reads it, and nothing puts it on the
`/run` wire (`wire.py` `request_to_wire`, `RunContext.to_wire` at
`sdks/python/agenta/sdk/agents/dtos.py:469-496`).

**Flip targets:** `DEFAULT_BUILD_KIT_OPS`
(`api/oss/src/apis/fastapi/applications/overlay.py:13-26`, 12 ops, no `test_run`);
flag default off (`platform_tools.py:36-43`). **Playbook seam:** the marked
paragraph is step 6 of `_BUILD_AN_AGENT_BODY`
(`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:154-160`), the wired-tools
list (`:192-195`), and the seam comment (`:207-208`).

**Contract pinning:** goldens at
`sdks/python/oss/tests/pytest/unit/agents/golden/run_request.{pi_core,claude}.json`
(neither carries `contextBindings`/`timeoutMs`/run kind today); Python side
`test_wire_contract.py:236,370` builds the payload from DTOs and compares whole-dict;
TS side `services/runner/tests/unit/wire-contract.test.ts` asserts every golden
top-level key is in `KNOWN_REQUEST_KEYS` (compile-time guard at `:66`) plus targeted
spec-field assertions. Adding fields means touching golden + Python builder + TS
assertions + `protocol.ts` + `wire_models.py` in ONE commit.

## Design decisions baked in

- **Injection is callRef-branch-only, runner-filled-last, fail-closed.** For a spec
  with `callRef` + `contextBindings`, the runner deletes whatever the model put at
  each bound arg path, resolves the `$ctx` token, and deep-sets the value — model can
  never override; an unresolvable token throws (mirrors `assembleBody`,
  `direct.ts:226-237`). The `call` branch keeps its own `call.context` mechanism;
  nothing is applied twice. The SDK validator already enforces `context_bindings` XOR
  direct-call (`models.py:393-396`).
- **run kind rides `runContext.run.kind`** (snake_case inner namespace, like
  `workflow`/`trace`), not a new top-level field. It is the run's own identity, the
  contract's suggested extension point (`protocol.ts:174-185`), and it makes
  `$ctx.run.kind` resolvable for free. The runner forwards it verbatim as
  `x-agenta-run-kind` on every child `/tools/call` (and, defensively, on direct
  calls), whenever set — not hardcoded to `"test"`.
- **Per-spec `timeoutMs` must reach BOTH timeout sites**: the host fetch
  (`callback.ts`) and the child/relay poll deadline (`dispatch.ts` `relayToolCall`).
  `timeoutMs` is not secret, so it joins `AdvertisedToolSpec`; `contextBindings` and
  `callRef` stay executor-private.
- **The kill switch changes semantics at flip time.** Today flag-off RAISES on a
  configured handler op (`platform_tools.py:86-93`) — correct while `test_run` is
  opt-in, but once it is in `DEFAULT_BUILD_KIT_OPS`, "flag off = raise" bricks every
  default build-kit agent. The flip commit makes explicit-off SKIP the op with a
  warning (resolution proceeds without `test_run`), keeps the env var
  (`AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`) as the kill switch, and defaults it ON.
  Recommendation: keep the flag one release, then delete via defer-todo.
- **Approval semantics untouched.** No changes to `permission-plan.ts`,
  `responder.ts`, or the decide/pause flow (#5041/#5066 machinery). We only add
  post-verdict argument shaping inside the already-allowed execution.

## Slices (one lane, one PR; each slice = one verifiable commit)

### Slice 5b.1 — the wire: `contextBindings` / `timeoutMs` / `runContext.run` on both sides

Files:
- `services/runner/src/protocol.ts` — `ResolvedToolSpec` += `contextBindings?:
  Record<string, string>` and `timeoutMs?: number` (doc: valid with `callRef` only;
  bindings are executor-private, runner-filled-last, hidden from the model).
  `RunContext` += `run?: { kind?: string }` (snake_case namespace note).
- `sdks/python/agenta/sdk/agents/dtos.py` — `RunContextRun` model; `RunContext.run`
  field; `to_wire` emits `run: {kind}` only when set (omit-when-empty, `:469-496`).
- `sdks/python/agenta/sdk/agents/wire_models.py` — `WireRunContext` += `run`
  (`WireRunContextRun`). Spec fields already exist (`:257-260`) — verify only.
- Goldens `run_request.pi_core.json` + `run_request.claude.json` — the existing
  callback spec (`customTools[0]`) gains `"contextBindings": {"target.workflow_variant_id":
  "$ctx.workflow.variant.id"}` + `"timeoutMs": 120000`; `runContext` gains
  `"run": {"kind": "test"}`.
- `sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py` — the pi/claude
  request builders set the fields via `CallbackToolSpec(context_bindings=...,
  timeout_ms=...)` and `RunContext(run=...)` so the whole-dict compare passes.
- `services/runner/tests/unit/wire-contract.test.ts` — assert
  `tool.contextBindings`, `tool.timeoutMs`, `req.runContext.run.kind` from the golden;
  `KNOWN_REQUEST_KEYS` unchanged (no new top-level key).
- `test_wire_models.py` schema assertion if it enumerates RunContext fields.

Acceptance: `py-run-tests` wire suites + `pnpm test` wire-contract green; a request
with none of the new fields serializes byte-identical to before (omit-when-empty).

### Slice 5b.2 — runner execution: inject bindings, honor `timeoutMs`, forward run kind

Files:
- `services/runner/src/tools/direct.ts` — export
  `applyContextBindings(args, bindings, runContext): Record<string, unknown>`:
  copy args if plain object else `{}`; per `[argPath, token]`: `deepDelete` →
  `resolveCtxToken` → throw
  `missing run-context value for tool binding '<argPath>'` on `undefined` → `deepSet`.
  `callDirect` gains optional `{ runKind }` → `x-agenta-run-kind` header (defense in
  depth; reserved handlers are only reachable via `/tools/call` today).
- `services/runner/src/tools/callback.ts` — `callAgentaTool` gains an options arg
  `{ timeoutMs?, runKind? }`: timeout = `timeoutMs ?? TOOL_CALL_TIMEOUT_MS`
  (`:42`); set `x-agenta-run-kind` when `runKind` is set. Update the two callers.
- `services/runner/src/tools/relay.ts` — in `executeAllowedRelayedTool`
  (`:267-304`): in the `callRef` (gateway fallback) branch ONLY, apply
  `applyContextBindings` when `spec.contextBindings` is set, then call
  `callAgentaTool` with `{ timeoutMs: spec.timeoutMs, runKind:
  runContext?.run?.kind }`. Pass `runKind` on the `spec.call` branch's `callDirect`
  too. No change to `executeRelayedTool`'s verdict flow (`:239-262`) — injection is
  after-verdict by construction.
- `services/runner/src/tools/dispatch.ts` — `relayToolCall` deadline honors a
  per-call timeout: `deadline = now + (timeoutMs ? timeoutMs + 10_000 :
  RELAY_TIMEOUT_MS)` (`:87`); `runResolvedTool` threads `spec.timeoutMs` into it and
  into the (unreachable-live) direct `callAgentaTool` branch. NO binding injection
  here — the child never holds private spec fields.
- `services/runner/src/tools/public-spec.ts` — `AdvertisedToolSpec` += `timeoutMs`;
  `advertisedToolSpec` copies it. `contextBindings`/`callRef` stay stripped.
- `pnpm run build:extension` — the Pi extension bundle in `dist/` must be rebuilt
  (registerTools executes `runResolvedTool` in-sandbox from the bundle; stale-bundle
  is a known silent failure mode from QA F-findings).

Tests (`services/runner/tests/unit/`):
- New `tool-callref-bindings.test.ts` through `startToolRelay` with a fake
  `RelayHost` + fetch stub: (a) allowed callRef spec with bindings → posted
  `function.arguments` carries the runner value even when the model supplied a
  conflicting `target.workflow_variant_id`; (b) missing run-context value → tool error
  response, no fetch; (c) deny spec → deny text, fetch never called; (d) ask spec →
  pause, fetch never called (verdict-before-injection pinned); (e)
  `x-agenta-run-kind` present iff `runContext.run.kind` set; (f) fetch abort at
  `timeoutMs` when set, `TOOL_CALL_TIMEOUT_MS` when not; (g) a `call`-descriptor spec
  is untouched by spec-level bindings (callRef-branch-only pinned).
- `tool-dispatch.test.ts` — `relayToolCall` deadline extends with `timeoutMs`.
- A public-spec assertion: advertised specs never carry `contextBindings`/`callRef`,
  do carry `timeoutMs`.

Acceptance: `pnpm test` + `pnpm run typecheck` green in `services/runner`.

### Slice 5b.3 — the agent service surfaces `meta.run_kind` into `runContext.run`

Files:
- `services/oss/src/agent/app.py` — in `_agent` (`:207`): read
  `(request.meta or {}).get("run_kind")`; when a non-empty string, stamp it onto the
  computed run context (`rc = run_context() or RunContext(); rc.run =
  RunContextRun(kind=...)`) before `SessionConfig(run_context=...)` (`:246-261`).
- New test `services/oss/tests/pytest/unit/agent/test_run_kind.py` (a NEW file —
  `test_invoke_handler.py` is owned by the applied `feat/pi-openai-codex-capability`
  lane): meta.run_kind="test" → wire payload `runContext.run.kind == "test"`; absent
  meta → `runContext` unchanged (no `run` key).

Acceptance: `cd services && py-run-tests` green; the end-to-end recursion chain is now
closed on paper: handler stamps meta (`platform_handlers.py:118-121`) → service stamps
runContext.run → runner forwards header → handler refuses (`:101-104`).

### Slice 5b.4 — the flip: overlay + flag default ON (kill-switch semantics change)

Files:
- `api/oss/src/apis/fastapi/applications/overlay.py:13-26` — add `"test_run"` to
  `DEFAULT_BUILD_KIT_OPS` (13 ops).
- `sdks/python/agenta/sdk/agents/platform/platform_tools.py:36-43,86-93` —
  `_platform_handlers_enabled()` defaults TRUE (env value `"false"`/`"0"` disables);
  flag-off now SKIPS the handler-mode op with a warning instead of raising (see
  design decisions — raise would brick every default agent under the kill switch).
- Tests: `api/oss/tests/pytest/unit/applications/test_build_kit_overlay.py` (ops
  pin + builtin grants pin), SDK resolver tests (flag-unset resolves; explicit-off
  skips and the remaining tools still resolve; no raise path left).
- keep-docs-in-sync touch points in the same commit:
  `docs/design/agent-workflows/documentation/tools.md` (op table + flag default),
  `documentation/agent-configuration.md` if it lists the overlay ops, and any env
  example that documents `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`.

Acceptance: fresh overlay agent's resolved tool set includes `test_run`; setting the
env to `false` yields the 12-op set with a logged warning, no resolution error.

### Slice 5b.5 — playbook seam swap

Files:
- `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py` — replace step 6
  (`:154-160`) with the `test_run` procedure: call `test_run` with a blunt
  instruction-framed `inputs.messages` + `expectations.terminal_tool`; warn the user
  first that a test run really fires external writes; read `verdict` /
  `verdict_reason` / `approvals`; on `incomplete`, rewrite instructions as a blunter
  numbered procedure and re-test; keep `query_spans` for verifying SCHEDULED fires
  (that is still its job per api-design). Update the wired-tools list (`:192-195`) to
  include `test_run`, adjust the footguns ("empty output ... inspect spans" line
  softens to the test_run digest), delete the seam comment (`:207-208`).
- Update whatever test pins the skill body/roster (grep `build-an-agent` under
  `sdks/python/oss/tests/` and `api/oss/tests/`; the 5a lane touched
  `test_static_catalog.py` / skill catalog tests).

Acceptance: skill tests green; the body names only tools that exist in the default
overlay after 5b.4.

### Slice 5b.6 — live verification (debug-local-deployment phase, not a commit)

Deploy notes first — three restart gotchas, all previously burned:
- The sub-sidecar has NO hot-reload and `run.sh --build` does not rebuild it:
  `docker restart agenta-claude-sub-sidecar` after ANY runner TS change.
- SDK (`sdks/python`) edits need the services + api containers restarted.
- The Pi extension bundle is prebuilt: verify the deployed image/compose command runs
  `build:extension`, or custom tools silently keep the old behavior (QA F-finding).

The matrix, per the agent-workflows-qa discipline (local + sidecar, cheap models):
1. **The full loop in playground chat** (pi_agenta, in-process/local): ask the builder
   agent to build a small agent, commit, then `test_run` itself → the approval gate
   surfaces in chat (`test_run` is non-read under `allow_reads`) → approve → digest
   returns with `output`, ordered `tools`, `resolved`, `verdict`. This is the lab
   capstone acceptance from the open-issues entry.
2. **Gated write in the child**: child config with a write tool → `approvals` lists
   it, verdict `unconfirmed`.
3. **Recursion refusal live**: `curl POST /tools/call` with the reserved ref and
   header `x-agenta-run-kind: test` → refused; and end-to-end, a child run's own
   `test_run` call is refused (runner forwards the header from
   `runContext.run.kind`).
4. **Timeout override**: a child run engineered past 30s completes (proves
   `TOOL_CALL_TIMEOUT_MS` no longer bites) and past 60s completes (proves the child
   poll deadline honors `timeoutMs`).
5. **Hand-authored-config path**: a non-overlay agent config that lists
   `{"type": "platform", "op": "test_run"}` resolves and runs (5a's flag error is
   gone).
6. **Claude cell** (if sidecar credit allows): the same `test_run` call over the
   internal MCP channel — the harness gate fires instead of the relay gate; injection
   still lands (the relay executes post-gate).
7. Known environment caveat, do not chase as a 5b bug: the local in-process →
   sub-sidecar path returns `trace_id=None` (sidecar persist 401s), leaving the span
   digest empty — pre-existing, tracked in status.md "Deferred / follow-ups".

## The 3 riskiest spots

1. **The child-side relay deadline and the stale extension bundle** —
   `services/runner/src/tools/dispatch.ts:87` (`deadline = Date.now() +
   RELAY_TIMEOUT_MS`) with `RELAY_TIMEOUT_MS=60s` (`relay.ts:60-62`). Honoring 120s on
   the host fetch alone still kills the call at 60s in the child's poll loop, and for
   Pi that loop lives in the PREBUILT extension bundle
   (`extensions/agenta.ts:266-270` → `dist/`), which has a documented history of
   shipping stale. The fix needs `timeoutMs` on `AdvertisedToolSpec`, the deadline
   change, a rebuilt bundle, AND live check 4 to prove it.
2. **The flip's kill-switch semantics and deploy skew** —
   `platform_tools.py:86-93` raises on flag-off; combined with
   `overlay.py:13-26` gaining `test_run`, an unchanged raise makes the kill switch
   (or any stale env) fail EVERY default build-kit agent's tool resolution. Separately,
   an old runner + new SDK skew silently drops the bindings, so the child `/tools/call`
   arrives without `target.workflow_variant_id` and the server rejects it — ship
   runner image and SDK together (same compose deploy), and make flag-off skip, not
   raise.
3. **Injection ordering across harnesses and the resume path** —
   `relay.ts:239-262` enforces the verdict only when `permissions.enforce` (Pi);
   Claude's gate is the harness's own, and the approved re-issue must re-enter
   `executeAllowedRelayedTool` to get the injection. The structure guarantees it
   (every execution funnels through `relay.ts:264` → `:267-304`), but a future branch
   that calls `callAgentaTool` directly (e.g. `dispatch.ts:260-267` becoming
   reachable) would bypass both verdict and bindings. Test (g) + the public-spec
   assertion pin this; keep injection ONLY in the callRef branch and bindings out of
   advertised specs.

## Constraints (restated from the project + owner rules)

- Approval machinery (#5041/#5066) untouched: no edits to `permission-plan.ts`,
  `responder.ts`, `acp-interactions.ts` beyond what the tests require (none expected).
- Injection in the `callRef` branch only; `call.context` stays the direct-call
  mechanism.
- One lane over big-agents, `but commit <lane> --only` + verify per commit; board row
  + BUT-LOCK for `but` writes; PR base `big-agents`, do not merge without review.
- Docs move in the same PR (keep-docs-in-sync): tools.md, agent-configuration.md,
  the interface inventory pages listing the `/run` spec fields
  (`cross-service/runner-to-tool-callback.md`, `public-edge/agent-config-schema.md`),
  and the api-design.md "5a shipped / 5b contract" section gets a "5b landed" note.
- After landing: close the open-issues 5b entry, add the status.md row, and file a
  defer-todo for deleting the kill-switch env after one release.
