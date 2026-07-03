# Where do logic-bearing internal tools live?

Status: proposal for Mahmoud's review, 2026-07-03. This is the heart of the project.

The question, restated: `test_run` (and future internal tools whose job needs
composition: invoke, wait, read spans, digest) does not fit the platform-op descriptor,
which wraps exactly one existing endpoint. The review's first answer was "add a composite
`/api` endpoint and wrap it thinly." Mahmoud rejected that framing: `test_run` is a
**tool**; the resource API should not go non-atomic to satisfy the current plumbing. So
where does the tool's logic run?

Evidence for every claim below is in [research.md](research.md) part 1. The constraints
any answer must respect:

- **Self-targeting**: the agent tests only itself. Today this is the `$ctx` binding the
  runner fills last and the model never sees (`direct.ts:205-239`).
- **Credential separation**: Agenta-internal auth never enters the user connections
  system. The precedent is `_prepare_invoke` signing its own `Secret` token per call
  (`workflows/service.py:2054-2062`).
- **Approval semantics untouched**: the relay's gate (`relay.ts:225-248`) and the
  permission model belong to the approval-boundary lane. Whatever home we pick must slot
  into that gate as one more tool, with zero changes to how gating works.

## The key observation

The platform already has TWO execution planes, and they have different atomicity rules:

- The **resource API** (`/api/workflows/...`, `/api/triggers/...`): nouns, atomic,
  Mahmoud's constraint holds here.
- The **tool-call plane** (`/tools/call` plus the direct-call dispatch): an RPC surface
  whose whole job is "execute one tool call". It is already composite: a `workflow.*`
  call_ref resolves a revision and runs an entire agent workflow server-side inside one
  tool call (`tools/router.py:1240-1330`). Nobody considers that endpoint "non-atomic
  API"; it is the tool executor doing tool-executor work.

So "no composite endpoint" and "the logic runs server-side" are not in conflict. The
composite logic can live behind the tool plane, in Python, without adding a verb to the
resource API.

## Option A: `$ctx` injection for gateway-style tools

**What it is.** Ship `test_run` as a server-executed tool on the existing `/tools/call`
plane (a reserved `tools.agenta.test_run` call_ref, like the v1 `find_capabilities`
dispatch at `tools/router.py:1141-1207`), and teach the relay to inject run context into
`callRef` dispatch the way it already does for `call` dispatch.

**Can the relay inject context into gateway calls?** Yes, cheaply. The machinery exists:
`resolveCtxToken` and the merge helpers live in `direct.ts:129-147` and are already
imported by `relay.ts`. Today the `callRef` branch passes `req.args` verbatim
(`relay.ts:283-289`). The change: allow a resolved spec to carry `context` bindings next
to `callRef` (the wire type change is small; `protocol.ts:122-127` currently documents
`context` under `call` only), and have `executeAllowedRelayedTool` fill the bound arg
fields from `runContext` before `callAgentaTool`. Fail hard on an unresolvable binding,
exactly like `assembleBody` does.

**Self-targeting.** Equivalent to today's guarantee: the runner overwrites the bound
fields last, the model-visible schema strips them (`op_catalog.py:126-143` already does
this for any `context_bindings`). A caller who bypasses the runner and hits `/tools/call`
directly holds a project credential and can already commit/schedule anything in the
project through the resource API, so nothing weakens.

**Trade-offs.**

- (+) Smallest possible footprint: one relay branch tweak, one server-side handler, one
  catalog entry. No new endpoint on the resource API.
- (+) Credential-clean: `/tools/call` runs under the caller's project auth; the internal
  invoke signs its own token server-side.
- (-) **Semantics muddle.** "Gateway" means an external provider action executed through
  the connections system. An internal Agenta op riding the gateway shape blurs the
  tool-type axes (builtin/gateway/code/client + platform) that the tool-definition
  redesign just cleaned up. The SDK would emit a platform-typed config that resolves to a
  gateway-shaped spec: two names for one thing, the exact failure mode the
  design-interfaces skill warns about (a field grouped by feature, not by role).
- (-) The catalog entry needs a second shape (`callRef`-emitting op next to
  `call`-emitting ops), so `PlatformOp` grows a mode switch anyway.

## Option B: runner-side composite ops

**What it is.** The runner learns multi-step ops: on `test_run`, the runner itself
invokes the agent, polls the trace, digests, and returns the verdict. Every API endpoint
stays atomic; the composition lives in TypeScript.

**Trade-offs.**

- (+) Timeout control is natural: the runner owns the loop, can stream progress events,
  and is not squeezed by its own `TOOL_CALL_TIMEOUT_MS`.
- (+) No API surface change at all.
- (-) **The runner cannot reach the invoke surface.** Direct calls are host-locked and
  confined to the `/api` mount (`direct.ts:310-323`); the agent service lives at
  `/services/agent/v0/invoke`, outside it. There is no `/api`-side invoke route today
  (verified: `apis/fastapi/workflows/router.py` exposes none). Option B therefore forces
  either loosening the SSRF guard (bad) or adding an `/api` invoke endpoint, which is the
  composite-endpoint concession Option B exists to avoid.
- (-) **It breaks the runner's design role.** The runner is a dumb executor: "it
  dispatches any `call` opaquely, the runner needs no platform-specific code"
  (`documentation/tools.md:260`; the same stance runs through `dispatch.ts` and
  `relay.ts` comments). Test-run semantics (span queries, verdict rules, digest shape)
  are product logic. Putting them in the sidecar splits that logic across languages,
  couples every verdict tweak to a runner image release, and duplicates span-reading code
  Python already owns.
- (-) The composition would run with only the caller credential and the runner's limited
  view; the server-side path gets revision hydration, delta application, and internal
  token signing for free (`_prepare_invoke`).

## Option C: a first-class server-side executor for internal logic-bearing tools

**What it is.** Option A's mechanics with honest names. Introduce a small, explicit
contract for "an Agenta-internal tool whose logic runs server-side with run context":

- **Catalog**: `PlatformOp` entries stay the single registry. An op either wraps one
  endpoint (today's `call` shape) or names a server-side handler (a new
  `handler: "test_run"` mode; exactly one of the two, mirroring the existing
  `input_schema` XOR `input_schema_ref` validator at `op_catalog.py:89-119`).
  `context_bindings`, schema stripping, `read_only`, and descriptions work identically
  for both modes, so self-targeting and approval inputs stay uniform.
- **Wire**: the resolved spec carries the reserved id as `callRef`
  (`tools.agenta.test_run`) plus `context` bindings. Kind stays `callback`; the executor
  axis does not grow a new value, because from the runner's seat this IS a callback: post
  the envelope, return the text. The only runner change is the generic context injection
  from Option A. (Naming note: if the approval-boundary lane would rather see an explicit
  `executor: "server"` marker on the gate descriptor, that is their call; the gate
  already receives `executor: "relay"` today, `relay.ts:226`.)
- **Server**: a handler registry in the tools domain
  (`api/oss/src/apis/fastapi/tools/` + `core/tools/`), keyed by op, next to the existing
  `tools.agenta.*` dispatch. The `test_run` handler composes
  `retrieve_workflow_revision` -> apply delta -> `invoke_workflow` -> spans query ->
  digest, all in Python, reusing `_prepare_invoke`'s auth pattern.

**Trade-offs.**

- (+) Respects every constraint: resource API stays atomic (the logic sits behind the
  tool plane, where composition is already the norm, see the `workflow.*` precedent);
  self-targeting rides the same `$ctx` machinery; credentials follow the
  `sign_secret_token` pattern; approval sees one more spec with a `read_only=False` hint
  and nothing else.
- (+) Honest interface: the catalog says what the tool IS (an internal op with
  server-side logic), instead of dressing it as a gateway action. Future logic-bearing
  ops (a richer verify, a config linter) get a named home instead of a second hack.
- (+) The runner change is generic and tiny (context injection on `callRef` specs), and
  it is useful beyond this project.
- (-) Touches the wire contract (spec-level `context` next to `callRef`), so the golden
  fixtures, `protocol.ts`, `wire.py`, and both contract tests move together (the
  runner CLAUDE.md change-both-sides rule).
- (-) One more mode inside `PlatformOp`. Mitigated by the existing XOR-validator pattern.
- (-) Sync execution still sits under the 30s/60s timeout ceilings; per-op
  `timeout_ms` plumbing is needed (see [api-design.md](api-design.md)). This cost is
  shared with Option A and D; only B escapes it, at the costs above.

## Option D: the composite endpoint (kept for comparison)

**What it is.** The review's original sketch: `POST /api/workflows/test` in the workflows
domain, wrapped by a thin platform op (part 2 of the tools-review, "test_run endpoint
sketch").

**Trade-offs.**

- (+) Zero runner and zero wire changes: it is a pure data add to the catalog plus one
  endpoint. Fastest to ship.
- (+) The endpoint is independently curl-able, testable, and documented in OpenAPI.
- (-) **Rejected framing.** It puts a verb ("test") into the resource API to compensate
  for tool-plumbing limits. The workflows domain would own an endpoint whose semantics
  (invoke + wait + digest + verdict) are tool semantics, not resource semantics.
- (-) Grows the public API surface for something only the builder agent calls.

## Recommendation

**Option C**, implemented as the formalized version of Option A: server-side handlers on
the existing tool-call plane, reached through the catalog with a `handler` mode, with the
relay gaining generic `$ctx` injection for `callRef` specs.

Why C over A: identical runtime footprint, but the contract says what the thing is. The
tool-type axes stay clean, and the next logic-bearing tool has a home instead of a
precedent for smuggling.

Why C over B: B is blocked on hard facts (the SSRF mount confinement, no `/api` invoke
route) and violates the runner's dumb-executor role; fixing either blocker costs more
than C's whole footprint.

Why C over D: D changes the resource API's character to save one week of plumbing; C
keeps the API atomic and pays with a small, reusable wire addition.

Fallback if the wire change is unwelcome right now: ship **D's endpoint under the tools
mount instead of workflows** (`POST /api/tools/...` is still a tool-plane path), wrapped
as a plain platform op. That keeps the workflows API atomic and needs no wire change, at
the cost of a slightly odd endpoint. Noted only so the decision has a cheap escape hatch;
C remains the recommendation.

The `test_run` contract under C, and how it degrades under A/B/D, is in
[api-design.md](api-design.md).
