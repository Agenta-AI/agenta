# Invoke negotiations — specs

> Status: **decided, ready to implement**. Distills the settled flag/header contract for
> `/invoke` (decisions locked 2026-07-03/04) out of the audit trail in
> `big-agents-audit/telemetry.md` (appendix + DECISION block) and
> `big-agents-audit/invoke-negotiation-traces.md`. Every current-state claim below was
> re-verified against `big-agents` HEAD `0b7cbad4f8` (2026-07-04): zero drift in any
> referenced file; the 61 negotiation/aggregation unit tests pass as-is.

## Problem

Four defects share one root cause — negotiation behavior is resolved in different layers
for different handlers:

1. **batch ≠ fold(stream).** The agent's batch path returns a synthetic single assistant
   message (`services/oss/src/agent/app.py:321`), while its stream path yields the full
   event turn. Accumulating the stream does NOT reconstruct the batch response. The
   runner's terminal `messages` is equally synthetic
   (`services/runner/src/engines/sandbox_agent.ts:864`); the real turn exists only in
   the event log.
2. **`stream` is consumed twice.** The normalizer drains generic generators when
   `stream=false` (`sdks/python/agenta/sdk/middlewares/running/normalizer.py:169-178`);
   the agent pre-branches on the same flag inside the handler (`app.py:277-279`). Two
   batch machineries, two different output shapes.
3. **`history` means different things per path.** On the envelope path it trims a
   messages list (`normalizer.py:197`); on the drained-generator path it trims raw
   EVENTS (`normalizer.py:172`), where "last" is the terminal `done` event — not a
   message. Its unset default (last) also silently violates `llm_v0`'s documented
   full-history contract (`engines/running/handlers.py:3636-3642`).
4. **The platform mutates handler output outside the handler.** The normalizer's
   courtesy aggregation (drain + trim) changes what a handler returns without the
   handler's participation.

## The rule

**Boolean command flags are resolved INSIDE the handler.** Handler output never changes
outside the handler. The HTTP edge (routing) keeps exactly two jobs: header→flag sugar
(fill an unset flag; an explicit body flag always wins) and the one HTTP-only,
value-typed negotiation — `format`. The running middleware keeps exactly one flag —
`resolve` — which it consumes AND strips before the handler. Anything a handler cannot
deliver is a **406**: can't-batch + batch-asked → 406; can't-stream + stream-asked →
406; `force` asked before its semantics exist → 406.

Headers and flags are separate namespaces with separate names: headers carry VALUES that
name an action or representation; flags are booleans. Absent header = *null* = the
default.

## The contract

| Concept    | Header (values \| null)                                      | Flag (bool) | null / unset →   | Resolved by        |
| ---------- | ------------------------------------------------------------ | ----------- | ---------------- | ------------------ |
| stream     | `Accept: application/json \| text/event-stream \| application/x-ndjson \| ∅` | `stream` | `false` (batch) | handler |
| transcript | `x-ag-messages-transcript: full \| last \| ∅`                | `trim`      | `false` (= full) | handler            |
| control    | `x-ag-session-control: force \| ∅` (new header)              | `force`     | `false`          | handler            |
| format     | `x-ag-messages-format: agenta \| vercel \| ∅`                | — no flag — | `agenta`         | routing (HTTP-only) |
| resolve    | `x-ag-workflow-embeds: resolve \| ∅` (new header)            | `resolve`   | **`true`**       | ResolverMiddleware |

Value→flag mappings: `last` → `trim=true` (`full`/∅ → `false`); `force` → `force=true`
(∅ → `false`); `resolve` → `resolve=true` and ∅ ALSO → `true` — `resolve` is the one
deliberate exception to null-means-false, preserving hydrate-by-default (no caller sends
`resolve=false` anywhere today; the unresolved-config consumer is the READ path, which
has its own `resolve` param on `WorkflowRevisionRetrieveRequest`). The explicit
off-switch is body-only (`flags: {resolve: false}`); no header value for it until a real
use case appears.

Invariant at handler time: `request.flags` contains exactly the three handler-owned
booleans — `stream`, `trim`, `force` — nothing middleware-owned, nothing consumed.
Renames: flag `history` → `trim`; flag `control` → `force`; header
`x-ag-messages-history` → `x-ag-messages-transcript` (same `full|last` values). No
deprecation window: no code sends the old header or old flag names today (verified —
the only negotiation header sent by any caller is `x-ag-messages-format: vercel`, from
`web/packages/agenta-playground/src/state/execution/agentRequest.ts` and
`web/oss/src/components/AgentChatSlice/assets/transport.ts`).

## The fold — batch = fold(stream), by construction

One pure function in the SDK (`agenta.sdk.agents`, next to the event DTOs):

```text
fold(events) -> { messages: Message[], stop_reason: str|None, pending_interaction: {...}|None }
```

- Input: the canonical agenta event vocabulary — `message_start/delta/end`,
  `thought_*`, `tool_call`, `tool_result`, `interaction_request`, `data`, `file`,
  `usage`, `error`, `done(stopReason)` (`services/runner/src/protocol.ts:288-335`,
  mirrored by `agents/dtos.py::Event`).
- Output messages carry the REAL turn: assistant text from message events, tool turns
  from `tool_call`/`tool_result` pairs, in order. `stop_reason` from `done`.
  `pending_interaction` from a trailing `interaction_request` when
  `stop_reason == "paused"` (this subsumes the hand-built paused envelope on the
  approval-boundary branch).
- Both `/invoke` shapes consume the SAME live `AgentStream`, so folding the stream
  client-side reproduces the batch envelope exactly. This removes the runner as a
  prerequisite: the runner's synthetic `result.messages` stops mattering for invoke
  (making it real becomes optional hygiene, tracked separately).

The trailing-unit trim is a second pure function beside it:

```text
trim_to_trailing_unit(messages) -> Message[]   # always a list; length by content, never type
```

- Last message is assistant text → `[that message]`.
- Turn ends in a tool/approval run → the whole trailing run (`tool_call` /
  `tool_result` / pending-approval messages) back to and including the assistant
  message that initiated it.

Contract test (the pin): drive the same request through stream and batch; fold the
streamed events; assert deep-equality with the batch `outputs`. Lives next to the
negotiation cube; RED against today's code by design.

## Both invoke surfaces comply — one negotiation, shared

There are TWO invoke surfaces and they MUST negotiate identically:

- the per-service route mounts (`/agent/v0/invoke`, `/llm/v0/invoke`, … via `route()`,
  `sdks/python/agenta/sdk/decorators/routing.py:542-599`), and
- the generic root dispatch (`POST /invoke`, `services/entrypoints/main.py:82-89`),
  which today does NO header→flag negotiation, no vercel input projection, and no
  session-id header extraction (body flags only) — so the same request diverges between
  surfaces (e.g. no-Accept + streaming handler: batch via a mount, ndjson via dispatch).

Fix: extract the endpoint prelude from `route()`'s `invoke_endpoint` into one shared
helper — header→flag fills (all five axes), session-id extraction
(body > `x-ag-session-id` > baggage), and the vercel input projection — and call it
from BOTH the route endpoint and `services_invoke`. One implementation, two surfaces,
byte-identical semantics; parity is pinned by test (same request + headers against a
mount and against dispatch → same response).

## agent_v0 — the canonical handler, SDK-registered (new)

Today the agent is the ONE builtin without a named SDK handler: `agenta:builtin:agent:v0`
exists in the SDK's catalog, configuration (`build_agent_v0_default`), and interface
registries, but NOT in `HANDLER_REGISTRY` (`engines/running/utils.py:344-360`) — the
handler is the service-local `_agent` (`services/oss/src/agent/app.py:207`), registered
only when the agent service process boots. Any other SDK process resolving the URI gets
nothing. This breaks the symmetry with `chat_v0`/`completion_v0`/`llm_v0` and makes the
agent the odd one out of the very contract that must hold "for agent AND llm."

Feasibility is verified: everything load-bearing already lives in the SDK — the
service's `tools/` package and `tracing.py` import ONLY `agenta.sdk.*`
(`agents.platform.gateway/secrets`, `agents.mcp`, `contexts.tracing`); the service
layer contributes pure composition (file-default template from the container, runner
url/dir env, gateway/vault provider wiring).

Decision: add **`agent_v0`** to the SDK, registered in `HANDLER_REGISTRY` under
`agenta:builtin:agent:v0`, akin to `llm_v0`:

- `agent_v0(request, inputs, messages, parameters)` owns the WHOLE flag contract:
  template parse, connection resolution, harness run, the stream/batch pre-branch, the
  fold, the trim, `force` → 406.
- Composition is injectable with working defaults: a composition seam (tool/MCP
  resolvers, secret provider, default template, backend selector) that defaults to
  env-driven behavior (`AGENTA_RUNNER_INTERNAL_URL`, no-op tool resolution) so
  `retrieve_handler` works in any SDK process; the agent SERVICE configures the seam
  (file-default template, gateway tool resolver, vault secret provider) and mounts
  `agent_v0` thin — exactly the `managed.py` pattern (`_create_managed_service`).
- The service-local `_agent`/`create_agent_app` shrink to composition + mount; the
  interface override (`AGENT_SCHEMAS`) stays service-side until schemas unify.

## Per-handler contracts

- **agent:v0** (SDK `agent_v0`; mounted by `services/oss/src/agent/app.py`). Keeps its
  pre-branch — the pattern is "a handler that takes `request` owns its negotiation."
  The event-stream shape is unchanged. The batch shape drains the same stream, applies
  `fold`, applies `trim_to_trailing_unit` when `trim=true`, and returns
  `{messages, stop_reason?, pending_interaction?}`. Reads `stream`/`trim`/`force` off
  its `request` arg. `force=true` → 406 (until the session take-over semantics land).
- **llm:v0** (`engines/running/handlers.py::llm_v0`). Already takes `request`; starts
  reading flags. `trim` applies to its `messages` envelope (default full — matches its
  documented contract, un-breaking the silent trim). It cannot stream: `stream=true` →
  406 via the symmetry rule (its batch response cannot satisfy a stream Accept — no
  handler change needed for the 406 itself, which routing already produces; the handler
  change is `trim` + `force` handling). `force=true` → 406.
- **chat / completion / evaluators** (incl. `auto_ai_critique_v0`). Flag-blind,
  unchanged outputs (single message / string / score dict). The 406 symmetry covers
  them: stream Accept → 406 (already today's behavior). They neither receive nor need
  the new flags.
- **Custom user workflows.** A generator handler with no `request` param can only
  produce a stream; JSON Accept → 406 (a conscious reversion of the courtesy
  aggregation — see Removals). A function handler behaves as today.

## Removals

- **Normalizer drain path** (`normalizer.py:169-178`) and **envelope trim**
  (`normalizer.py:194-197`): deleted. The normalizer goes back to shape-agnostic
  passthrough: typed responses pass, generators become stream responses, everything
  else becomes a batch response. No output mutation.
- **`history`** flag and `x-ag-messages-history` header: replaced by the renames above.
- **`resolve` reaching the handler**: the ResolverMiddleware strips it from
  `request.flags` after hydration (`middlewares/running/resolver.py:603`).

## Out of scope (tracked, deliberate)

- **The sessions command plane** (`POST /sessions/streams/`, the `prompt × force`
  matrix) stays as-is: built, uncalled. The invoke-plane `force` flag is its future
  twin; wiring the `inputs × force` take-over semantics is a separate design.
- **`format` push-down** into handlers: parked; format stays HTTP-only at routing.
- **Runner `result.messages` fidelity** (make it the real turn instead of synthetic):
  optional hygiene once the fold ships; not needed for the contract. (The
  dispatch-surface asymmetry, formerly out of scope as F-NEG-1, is now IN scope — see
  "Both invoke surfaces comply" above.)

## Testing contract — four levels, full flag/header coverage at each

The contract must be pinned at every layer it crosses, not just the outermost
(the original review challenge: "are you testing at the right layers — `@route`,
`@instrument`, `@workflow`?"). Four levels, each with its own axis set — headers exist
only at the route level; below it, the axes are the body flags.

**Level 1 — handlers, called directly (llm, agent).** Construct a
`WorkflowServiceRequest` and call `_agent` / `llm_v0` as functions (the existing
pattern: `services/oss/tests/pytest/unit/agent/test_invoke_handler.py`). Axes:
`stream {unset, false, true}` × `trim {unset, false, true}` × `force {unset, false,
true}` — the full 27 combinations per handler (cheap: mock the harness / the LLM call).
Asserts handler-OWNED resolution: agent branches to event-generator vs folded envelope;
trim trims the trailing unit; unset = the defaults (batch, full, no-force);
`force=true` raises the 406-mapped error; llm_v0 ignores `stream`, honors `trim` on its
envelope, rejects `force`. Plus the fold + trailing-unit-trim unit tests on the event
vocabulary (tool runs, paused turns, error turns, thought/data/file events).

**Level 2 — `@workflow` (programmatic `wf.invoke()`, no HTTP).** The running layer:
body flags only. Axes: the same 27-combination cube driven through
`workflow(...)(handler).invoke(request=...)` for BOTH a request-taking handler (agent
shape) and a flag-blind generator/function handler. Asserts the normalizer is now a
passthrough: no drain, no trim, generator → stream response, dict → batch response
UNMODIFIED; `resolve` is consumed and STRIPPED (handler sees exactly
`{stream, trim, force}`); flag-blind generator + `stream=false` yields a stream
response that the route layer will 406 (the symmetry rule's running-layer half).
Replaces `test_workflow_aggregation_running.py`'s aggregation assertions (and its stale
"RED today" docstring).

**Level 3 — `@instrument` (tracing, in-memory exporter).** The invariance pin: for the
SAME handler, the span tree and the span's accumulated `ag.data.outputs` are IDENTICAL
across every flag/header combination — negotiations change the RESPONSE, never the
trace. Extend `test_workflow_instrument_programmatic.py` /
`test_routed_trace_invariant_across_format_and_history` from the current 3-axis sweep
to the 5-axis one (stream × format × transcript × control × embeds). The instrument
layer stays flag-blind (`decorators/tracing.py`) — any diff in span content across
combinations is a regression.

**Level 4 — `@route` (TestClient over the real mounted apps).** The only level where
headers exist — and it covers BOTH surfaces: every sweep below runs against a route
mount, and the dispatch-parity test re-runs a representative subset against the root
`POST /invoke` asserting identical responses (see "Both invoke surfaces comply"). Two
sweeps:
- *Header semantics per axis*: `Accept {∅, json, event-stream, x-ndjson}` ×
  `x-ag-messages-transcript {∅, full, last}` × `x-ag-session-control {∅, force}` ×
  `x-ag-workflow-embeds {∅, resolve}` × `x-ag-messages-format {∅, agenta, vercel}` —
  asserting each header's value→flag mapping, null = default, and body-flag precedence
  (body wins over header) for every axis that has both.
- *Real handlers over the wire*: the negotiation cube re-run against the REAL
  `/agent/v0/invoke` and `/llm/v0/invoke` mounts (today's cube uses synthetic shapes
  only), plus the batch=fold(stream) CONTRACT test: same request, streamed then batch;
  fold(streamed events) deep-equals batch `outputs`. Plus the 406 matrix:
  batch-only handler × stream Accept, stream-only handler × JSON Accept, `force`
  header/flag on both handlers.

The full 5-axis route cross-product is large; the required set is: full pairwise
(each axis × each other axis) on the synthetic shapes, and the full stream × transcript
× format cube on the two real handlers. Anything beyond that is optional.

CHANGED tests (conscious flips): the courtesy-aggregation pins become 406 assertions
(`test_stream_shape_no_accept_aggregates_to_batch`,
`test_stream_shape_json_accept_aggregates_events_to_batch`, the drain-path history
tests, `test_invoke_route_aggregation_routing.py` aggregation cases). UNCHANGED: the
rest of the observability suites; acceptance assertions on the agent batch envelope
update to the folded turn (`test_routed_agent_messages_batch_trace`).
