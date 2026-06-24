# Project: A schema-driven `/run` contract

| | |
| --- | --- |
| **Status** | Plan. Not started. Awaiting review before any code. |
| **Type** | Engineering project (a sequenced, test-driven migration), not a one-shot change. |
| **Scope** | Replace the hand-mirrored `/run` wire contract with a single schema source; add boundary validation; evaluate splitting `/run`; fold in a structured error model and a carried contract version. |
| **Owner files (today)** | `services/agent/src/protocol.ts` (TS types), `sdks/python/agenta/sdk/agents/utils/wire.py` (Python mirror), `sdks/python/oss/tests/pytest/unit/agents/golden/` (fixtures), `sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py` + `services/agent/tests/unit/wire-contract.test.ts` (the two contract tests). |
| **Reference** | The deep spec of the contract as built: [`../runner-interface/README.md`](../runner-interface/README.md). Its Section 12 ("Known gaps") names the exact gaps this project closes. The inventory page: [`../../interfaces/cross-service/service-to-agent-runner.md`](../../interfaces/cross-service/service-to-agent-runner.md). |
| **Mirroring rule today** | `services/agent/CLAUDE.md` ("The wire contract is mirrored — change both sides"). |

## 1. The problem, precisely

The `/run` contract is the spine of the agent stack: the Python agent service builds a request,
the Node runner executes a turn, and returns a result or a stream of events. The contract is
**defined twice** and kept in sync **by hand**:

- TypeScript: `services/agent/src/protocol.ts` declares `AgentRunRequest`, `AgentRunResult`,
  the `AgentEvent` union, `HarnessCapabilities`, and the sub-objects (`ResolvedToolSpec`,
  `ToolCallbackContext`, `McpServerConfig`, `SandboxPermission`, `TraceContext`, `WireSkill`,
  `ContentBlock`, `ChatMessage`, `AgentUsage`, `RenderHint`, `StreamRecord`).
- Python: `sdks/python/agenta/sdk/agents/utils/wire.py` (`request_to_wire` / `result_from_wire`)
  plus the BaseModels in `sdks/python/agenta/sdk/agents/dtos.py` (`Message`, `AgentEvent`,
  `AgentResult`, `HarnessCapabilities`, `TraceContext`, `SandboxPermission`, ...) re-create the
  same field names by hand.

The **only** guard against the two drifting is four golden fixtures
(`golden/run_request.{pi,claude}.json`, `golden/run_result.{ok,error}.json`) asserted by two
tests. The TS test adds a compile-time key guard (`KNOWN_REQUEST_KEYS` assigned to
`(keyof AgentRunRequest)[]`), and the Python test holds a parallel `KNOWN_REQUEST_KEYS` set.

This is brittle for concrete, observed reasons:

1. **Two hand-kept key lists.** `KNOWN_REQUEST_KEYS` is duplicated in
   `test_wire_contract.py` and `wire-contract.test.ts`. A new field means editing five places
   (golden, `protocol.ts`, `wire.py`, both key lists) "deliberately", per the CLAUDE.md rule.
2. **No runtime validation at the boundary.** `POST /run` JSON-parses the body and runs with
   whatever fields are present; an empty body becomes `{}` (`server.ts`). A malformed or
   misspelled field is silently ignored, not rejected. The contract is *implicitly all-optional*
   (every TS field is `?`, every Python field defaults). A typo like `sandboxPermision` is
   dropped on the floor with no error. This is `runner-interface/README.md` §12 gap
   "No schema validation on the runner".
3. **The version skew guard is exposed but unconsumed.** `version.ts` exports
   `PROTOCOL_VERSION = 1` and `/health` returns it, but **no Python caller probes `/health`**
   (verified: no reference to `runnerInfo`/`PROTOCOL_VERSION`/`/health` in the runner-calling
   path). A client and runner can silently disagree across a major bump. §12 gap "The version
   skew guard is not consumed".
4. **The error model is a free string.** `AgentRunResult.error?: string` with no taxonomy and
   no machine-readable code; `result_from_wire` turns any `ok:false` into a generic
   `RuntimeError(f"Agent run failed: {error}")`. There is **no distinct cancelled outcome** —
   a user/client abort surfaces (if at all) as a transport teardown or a generic error, not as a
   first-class result. §12 names neither, but the user has scoped this as the A10 cleanup.

The fix is a **single source of truth** plus **boundary validation**, sequenced so each step is
a small change with a test that proves it, and folding in the sibling-project changes (A1
versioning, A3 backend removal + harness rename, A10 error model).

## 2. What this project changes vs leaves alone

**In scope:**

- One schema as the source of truth for the `/run` request, result, event union, capabilities,
  and the sub-objects listed above.
- Runtime validation of `/run` at the Node boundary (reject malformed input with a clear error).
- A symmetric validation on the Python parse path (reject a malformed result).
- A structured error object `{ code, message, retryable }` and a distinct `cancelled` outcome.
- A contract version carried in the payload (not only on `/health`), and a probe that consumes
  it.
- A decision on splitting `/run` into more than one endpoint.
- Replacing the four golden fixtures + two key lists with schema-derived checks (the golden
  fixtures stay as *examples that must validate*, not as the only guard).

**Explicitly unchanged by this work** (called out so reviewers do not expect movement):

- **Composio, the tool gateway, connections, and MCP** all continue to work exactly as today.
  They are inputs the service already resolves: `customTools` (gateway callback / code / client),
  `toolCallback`, `mcpServers`, `connection` / `provider` / `endpoint` / `credentialMode`. This
  project re-expresses their **shapes** in a schema and validates them; it does not change how
  any of them resolve, route, or authenticate. The Composio key stays server-side; the gateway
  callback still POSTs to `/tools/call`; MCP `stdio`/`http` shapes are preserved byte-for-byte.
- The transports (HTTP + subprocess CLI) and the two modes (one-shot JSON + NDJSON streaming).
- The harness shaping logic (`config.wire_tools()` etc.) — the schema describes the *output*
  of that shaping, it does not move the shaping.
- Tracing (`trace` / `TraceContext`) and the trace-export boundary.

## 3. Current contract surface (assessment)

The contract has four families. This is what a single schema has to cover.

### 3.1 Request (`AgentRunRequest`)

~30 top-level fields, **all optional on the wire**, grouped by job:

| Group | Fields |
| --- | --- |
| engine + placement | `backend`, `harness`, `sandbox`, `sessionId` |
| instructions | `agentsMd`, `systemPrompt`, `appendSystemPrompt` |
| model + connection | `model`, `provider`, `connection {mode, slug?}`, `deployment`, `endpoint {baseUrl?, apiVersion?, region?, headers?}`, `credentialMode`, `secrets` |
| turn | `prompt`, `messages` (`ChatMessage[]`) |
| tools + skills | `tools` (string[]), `customTools` (`ResolvedToolSpec[]`), `toolCallback`, `mcpServers`, `skills` (`WireSkill[]`) |
| policy + files | `permissionPolicy`, `sandboxPermission`, `harnessFiles` (`[{path, content}]`) |
| tracing | `trace` (`TraceContext`) |

Back-compat splits the schema must preserve: a plain-string `model` keeps `provider` /
`connection` / `deployment` / `endpoint` / `credentialMode` **off** the wire; `mcpServers`,
`skills`, `sandboxPermission`, `harnessFiles` are **omitted** (not null) when empty so a
minimal payload stays byte-identical to the golden.

### 3.2 Result (`AgentRunResult`)

`ok` (bool), `output?`, `messages?`, `events?`, `usage?` (`AgentUsage`), `stopReason?`,
`capabilities?` (`HarnessCapabilities`), `sessionId?`, `model?`, `traceId?`, `error?` (the free
string this project replaces). `ok:false` raises in Python (`result_from_wire`).

### 3.3 The event union (`AgentEvent`)

A discriminated union on `type`: `message`, `thought`, the `message_*` / `reasoning_*` lifecycle
trios, `tool_call`, `tool_result`, `interaction_request`, `data`, `file`, `usage`, `error`,
`done`. Plus `StreamRecord = {kind:"event",event} | {kind:"result",result}` for NDJSON framing.
Note: the Python side intentionally **drops unknown event types** on parse
(`AgentEvent.from_wire` returns `None` for a typeless event), and a golden pins that. The schema
must keep events **open/forward-compatible**, not closed.

### 3.4 Sub-objects

`ResolvedToolSpec` (the three-axis tool surface: `kind`/`runtime`/`code`/`env`/`callRef`,
`needsApproval`, `render`, `readOnly`, `permission`), `ToolCallbackContext`, `McpServerConfig`,
`SandboxPermission` (nested `network`, `filesystem`, `enforcement`), `HarnessCapabilities` (11
boolean flags), `TraceContext`, `WireSkill` + `WireSkillFile`, `ContentBlock`, `ChatMessage`,
`AgentUsage`, `RenderHint`.

### 3.5 The existing golden/test machinery

- `golden/run_request.pi.json` (full Pi shape: tools, skills, sandboxPermission, prompt overrides),
  `golden/run_request.claude.json` (Claude shape: empty `tools`, `permissionPolicy:"deny"`,
  `harnessFiles` with rendered `.claude/settings.json`).
- `golden/run_result.ok.json` (includes a typeless event to pin the drop behavior),
  `golden/run_result.error.json` (`{"ok": false, "error": "model exploded"}`).
- Python `test_wire_contract.py`: builds payloads via the real configs and asserts `== golden`,
  plus `set(payload) <= KNOWN_REQUEST_KEYS`.
- TS `wire-contract.test.ts`: loads the goldens, asserts shapes through the runner helpers
  (`resolvePromptText`, `messageText`, `resolveRunSessionId`), and the two compile-time guards
  (`KNOWN_REQUEST_KEYS` / `CAPABILITY_KEYS` assigned to `keyof` types).

The machinery is **good** and we keep its spirit: the goldens become "examples that must validate
against the schema", and the duplicated key lists are replaced by schema-derived assertions.

## 4. Design options for a single source of truth

Three candidates, judged against this stack: **Python Pydantic 2 SDK** + a **standalone Node ESM
runner package** (`services/agent`) that has its own `pnpm-lock.yaml`, runs through `tsx` with
**no app compile step and no codegen toolchain today**, and is deliberately decoupled from the
`web/` dependency graph. There is no JSON-Schema codegen, no `quicktype`,
no `datamodel-code-generator`, and **no zod** anywhere in the runner or web (verified).

### Option A — JSON Schema as source, codegen both sides

Author the contract as hand-written JSON Schema files; generate TS types
(`json-schema-to-typescript`) and Pydantic models (`datamodel-code-generator`) from them. Both
sides validate with the schema at runtime (ajv on Node, `jsonschema`/Pydantic on Python).

- **Pros:** language-neutral source; one artifact; both sides are generated, so neither drifts.
- **Cons:** introduces **two new codegen toolchains** into a repo that has none for this, and a
  build step into a package that intentionally has none (`services/agent/CLAUDE.md`: "no app
  compile step"). Hand-writing JSON Schema is verbose and error-prone for a union as rich as
  `AgentEvent` + `RenderHint`. The Python SDK already has hand-written BaseModels with custom
  `to_wire`/`from_wire` (camelCase aliasing, the `model`-string back-compat split, the
  drop-unknown-event behavior); regenerating them from schema would either lose that behavior or
  require post-gen patching. High blast radius, fights the existing grain.

### Option B — Pydantic as source, export JSON Schema, validate on the TS side (RECOMMENDED)

Make **Python Pydantic models the source of truth** — but a **dedicated set of *wire* models**,
NOT the existing semantic DTOs. This distinction is load-bearing (it was the sharpest review
finding): the real contract today does not live in `dtos.py`'s classes — it lives in the **hand
serializers** (`request_to_wire` builds a raw dict; `Message.to_wire`, `TraceContext.to_wire`,
`AgentEvent.from_wire`, etc. do the camelCase + omit + drop-unknown work). The semantic DTOs use
**snake_case** fields (`text_messages`, `mime_type`, `capture_content`) and an intentionally
loose `AgentEvent` (`type: str` + free `data` dict, vs the real discriminated union in
`protocol.ts`). Exporting `model_json_schema()` straight off those DTOs would produce the *wrong*
schema (snake_case keys, a non-discriminated event). So:

- Author new wire models in the SDK (e.g. `agents/wire_models.py`): `WireRunRequest`,
  `WireRunResult`, and an **explicit discriminated `WireAgentEvent` union** (real variants on
  `type`, plus an open fallback variant so unknown event types still validate, matching the
  current drop-unknown tolerance) — with camelCase aliases (`populate_by_name=True`, as
  `AgentConfig` already does), explicit nullability, and the exact field set the serializers emit.
- These wire models become the single producer: `request_to_wire` / `result_from_wire` are
  reimplemented in terms of them. The omit-when-empty behavior stays as serializer logic + golden
  checks — `model_json_schema()` expresses "optional", not "omit when empty".
- Pydantic 2's `model_json_schema()` exports the JSON Schema artifact **for free**, no new
  toolchain. Commit it as `services/agent/contract/run-contract.schema.json`.
- The TS runner validates incoming `/run` against it with one small validator (ajv, the one new
  runner dep) — **no codegen, no build step**: the schema is data the runner loads.

- **Pros:** fits the stack — Pydantic 2 is already the SDK's modeling layer (`pydantic>=2,<3`);
  the producer (Python) is the natural source since it builds the request. Schema export is a
  built-in, not a new tool. The runner gains real runtime validation with one dependency (ajv)
  and zero build step, honoring the standalone-package constraint. The omit-when-empty behavior
  stays in Python where it already lives and is tested. The exported schema becomes a
  **CI-checked artifact**: a test fails if the committed schema drifts from the wire models.
- **Cons:** requires writing dedicated wire models (a real cost, but it is the honest cost of a
  single source — the alternative is the current double-maintenance). For the TS *types* there are
  two sub-options: **(b1)** keep hand-written `protocol.ts` + a schema-derived guard, or **(b2)**
  generate `protocol.ts` from the schema with `json-schema-to-typescript` as a committed artifact
  (a checked-in generated file run by a script, not a runtime build step). A hand-written
  `protocol.ts` + a top-level key guard does **not** catch *nullability* drift — the Claude golden
  sends `sessionId: null` / `trace: null` while `protocol.ts` types them `?: string` (present-or-
  absent, not nullable). So b1 needs schema-derived type-equivalence tests deeper than keys, and
  **b2 (generate the types) is the safer end state**. This is an open question (§10).

### Option C — A shared IDL (`.proto`, Smithy, etc.)

Define the contract in a neutral IDL and generate both sides + a validator.

- **Pros:** strongest neutrality; mature codegen.
- **Cons:** the heaviest option for an internal JSON-over-HTTP/stdio boundary. The wire is JSON,
  not protobuf; adopting proto means either proto-over-JSON (awkward) or changing the wire format
  (out of scope and risky). Brings a build toolchain and a new language into a two-language repo
  that wants fewer moving parts. The `AgentEvent` open-union + "drop unknown" semantics fit JSON
  Schema's `additionalProperties`/`oneOf` better than proto's closed messages. Overkill.

### Recommendation: Option B (Pydantic-as-source → exported JSON Schema → ajv validation in the runner)

It is the only option that adds **one** runtime dependency (ajv) and **zero** runtime build
steps, fits the Pydantic 2 stack, keeps the custom serialization semantics where they are tested,
and turns the schema into a CI-checked artifact that makes drift a failing test instead of a
code-review discipline. Source of truth = dedicated Pydantic **wire** models (not the semantic
DTOs); the exported `run-contract.schema.json` is the shared artifact; the TS types are best
**generated** from it (sub-option b2) so nullability drift cannot hide.

## 5. Runtime validation at the boundary

Today `/run` is implicitly all-optional and silently drops typos. The plan:

- **Runner ingress (request).** In `server.ts` / `cli.ts`, after JSON-parse, validate the body
  against `run-contract.schema.json` with ajv. On failure, return a structured `400` (HTTP) /
  exit 1 (CLI) with the validator's error path — e.g. `{ ok:false, error:{ code:"invalid_request",
  message:"sandboxPermission.network.mode: must be one of on|off|allowlist", retryable:false } }`.
  Replace today's "empty body -> `{}` runs with defaults" with an explicit allowance: an empty
  body is still valid (the contract tests rely on it), but a *present but malformed* body is
  rejected. Decide on `additionalProperties`: start **permissive** (warn/log unknown top-level
  keys, do not reject) to avoid breaking a newer service against an older runner, and tighten to
  reject in a later, version-gated step. Unknown **event** types stay tolerated by design.
- **Python egress (request) — optional symmetric guard.** `request_to_wire` can validate its own
  output against the same schema in tests (and optionally under a debug flag at runtime), so the
  producer cannot emit a payload the runner would reject. This is the producer-side half of the
  guard and is cheap because the schema already exists.
- **Python ingress (result).** `result_from_wire` gains schema validation of the result before
  it constructs `AgentResult`, so a malformed runner result fails loudly rather than producing a
  half-empty `AgentResult`.

The validator is **not** a behavior change to any resolved input (tools, gateway, MCP,
connections are validated for shape only, never re-resolved).

## 6. The `/run` split decision

The user agrees `/run` does too much. `/run` today conflates: (a) a one-shot turn, (b) a
streaming turn (same route, switched by `Accept`), and (c) there is no separate way to ask "what
can this runner do" except the unconsumed `/health`. Evaluated splits:

### Keep as one endpoint: single-turn vs streaming

**Do NOT split** one-shot and streaming into two endpoints. They share the identical
`AgentRunRequest` and return the identical `AgentRunResult` (the streaming terminal `result`
record is the same object with `events` emptied). The only difference is the `Accept` header
selecting the framing. The `runner-interface` RFC §6 calls this the "symmetry guarantee", and
both Python transports already parse both with the same `result_from_wire`. Splitting would
duplicate the request schema and the dispatch for no contract benefit. Content negotiation
(`Accept: application/x-ndjson`) is the right axis and is already in place. **Verdict: keep.**

### Split out: a capability / contract probe

**DO formalize the probe.** `/health` already returns `{status, runner, protocol, engines,
harnesses}` but nothing consumes it, and `HarnessCapabilities` (per-harness, 11 flags) is only
discoverable by doing a full run. Recommendation:

- Keep `GET /health` as the cheap liveness + identity + **contract version** probe (it already
  carries `protocol`). This is what the A1 version check consumes (Section 7).
- Add `GET /capabilities` (or `GET /capabilities?harness=pi`) that returns the static **base**
  `HarnessCapabilities` per harness **without running a turn**. Today capabilities are probed
  per-run and returned in the result; a static probe lets the service/playground render UI and
  pre-validate a request (e.g. reject `images` for a harness that lacks `fileAttachments`) before
  spending a run. The probe must state base-vs-effective explicitly: some flags are
  mode-dependent (`streamingDeltas` is derived at run time in `engines/sandbox_agent.ts`), so the
  static probe returns **base** capabilities and the run result stays authoritative for
  mode-dependent flags. This is additive, not a split of `/run`'s job.

**Verdict: keep `/run` unified for the turn; promote a `/capabilities` probe and actually consume
`/health`.** This removes work from the run path (capability discovery) without fragmenting the
turn contract.

### Considered and rejected

- A separate `/cancel` endpoint: rejected. Cancellation is correctly modeled as transport
  teardown (close the NDJSON connection / kill the subprocess), already wired for
  `runSandboxAgent` over HTTP. A `/cancel` would need session affinity the cold runtime does not
  have. The A10 change adds a *cancelled outcome* (Section 7), not a cancel endpoint.
- A separate tool-callback or MCP endpoint on the runner: out of scope and unchanged — those are
  the runner *calling out* (`/tools/call`) and the gateway/MCP surfaces, which this work does not
  touch.

## 7. Folding in the sibling projects (A1, A3, A10)

This project assumes and coordinates with three parallel efforts. The schema is where they meet.

### A3 — backend removal + harness rename (assumed end state)

A3 removes the legacy in-process backend and the `backend` field, and renames harness values
`pi -> pi_core` and `agenta -> pi_agenta`. The schema must land **after** or **with** A3, or it
will pin the wrong enum. Concretely in the schema:

- **Drop `backend`** from `AgentRunRequest` (the runner no longer dispatches on an engine id; one
  engine path remains). Remove it from the key lists and goldens.
- **`harness` enum becomes** `pi_core` | `pi_agenta` | `claude` (was `pi` | `agenta` | `claude`).
  Update `version.ts` `HARNESSES`, the goldens, and the schema enum together.
- Because A3 removes a field and changes an enum, it is a **breaking** contract change. It shares
  **one** `PROTOCOL_VERSION` bump with the A10 error-model change (the single v2 cut in step 8) —
  it does NOT get its own separate "also v2" bump (a second breaking change after a bump is not
  incremental). The migration introduces the schema *first* at v1 (behavior-preserving, steps
  1-6), then makes A3 + A10 the single v2 cut, so the schema work is not blocked on A3 landing. If
  the team would rather decouple them, A3 becomes a distinct **v3** cut — but the two breaking
  changes must not collapse into one ambiguous "v2" label.

### A1 — versioning (coordinate: the schema carries/enables a contract version)

A1 is the sibling project [`../contract-versioning/`](../contract-versioning/) (it owns the
versioning strategy for the cross-service contracts). It independently found the same gap this
project relies on: the runner advertises `protocol: 1` on `/health` (`version.ts`) but the Python
client (`ts_runner.py`) never reads it — no negotiation, no skew guard. This project makes the
schema **carry** the contract version so skew is detectable in-band, not only via `/health`:

- Add an optional `contractVersion` (int major) to `AgentRunRequest` and `AgentRunResult`. The
  service stamps the major it built for; the runner can reject a major it does not support with a
  structured `{ code:"unsupported_contract_version", ... }` error (see A10) instead of silently
  mis-parsing.
- Consume the version on **both transports**, not only `/health` (the backend chooses HTTP or
  subprocess in `adapters/sandbox_agent.py`, and the CLI has no health mode): the HTTP path probes
  `GET /health.protocol`; the subprocess/CLI path needs a `--version`/`--protocol` mode (or reads
  the in-band `contractVersion` echoed on the result). Either way the client refuses a runner
  whose major it does not understand, closing the §12 "version skew guard is not consumed" gap.
  The schema artifact itself is versioned by the same major.
- Exact ownership of the bump mechanics stays with A1; this project provides the in-payload field
  and the probe consumption. The two must agree on the major-number semantics (single int major,
  surfaced on `/health` as `protocol` and in-band as `contractVersion`).

### A10 — error model cleanup (in scope here)

Replace `AgentRunResult.error?: string` with a structured error and add a distinct cancelled
outcome:

```jsonc
// AgentRunResult, error branch
{
  "ok": false,
  "error": {
    "code": "model_error",            // taxonomy, see below
    "message": "model exploded",      // human-readable, what today's string held
    "retryable": false                // does a naive retry have a chance?
  }
}
```

- **Error taxonomy (`code`)**, a closed-ish enum the runner sets and the service can branch on:
  `invalid_request` (schema validation failed), `unsupported_contract_version`,
  `unsupported_harness`, `auth_error`, `quota_exceeded`, `rate_limited`, `configuration_error`,
  `permission_denied`, `model_error`, `tool_error`, `mcp_error`, `sandbox_error`, `timeout`,
  `cancelled`, `internal`. The `auth_error` / `quota_exceeded` / `rate_limited` codes are not
  speculative: the runner already pattern-classifies these from provider error text in
  `services/agent/src/engines/sandbox_agent/errors.ts` — the schema just gives that classification
  a stable wire code. Keep the enum forward-compatible (an unknown code -> treat as `internal`),
  mirroring the event "drop unknown" tolerance.
- **`retryable`** lets the caller distinguish a transient `timeout` / `rate_limited` / `mcp_error`
  from a permanent `invalid_request` / `unsupported_harness` / `auth_error`.
- **Distinct cancelled outcome — but only where it is actually deliverable.** A user/client abort
  is **not** a failure. The subtlety (a real review catch): a *client disconnect* mid-stream
  cannot reliably receive a terminal record, because the disconnect is exactly what tears the
  transport down — `server.ts` aborts the run *on* response `close`, and the Python streaming
  transports treat a stream with no terminal `result` as an error (`ts_runner.py`). So:
  - **Cooperative cancellation while the transport is still open** (e.g. an in-band stop signal,
    or a future `/cancel`-style affordance): emit the terminal `{ ok:false, error:{code:
    "cancelled"} }` record — the §8b "exactly one terminal result" invariant holds and the result
    stays authoritative. Set `retryable:false` (or omit it) — a cancel is intentional, not a
    transient fault.
  - **Transport teardown (the disconnect case we have today)**: the terminal record cannot be
    delivered; the Python side must map "generator cancelled / connection closed by us" to a
    distinct **`CancelledError`-style outcome**, NOT the generic "stream ended without a terminal
    result" `RuntimeError`. This is a Python-side parsing/exception change, not a wire record.
  - Optionally also emit a `done` event with `stopReason:"cancelled"` for streams (useful as a
    live signal), but the terminal result remains authoritative when the connection is alive.
- **Migration:** `result_from_wire` must accept **both** the old free-string `error` and the new
  structured object during the transition (parse a string into `{code:"internal", message:str,
  retryable:false}`), so an old runner against a new service still parses. The structured form is
  the v2 shape; the string form is read-compat only.

This is a contract change (new error shape) and folds into the same v2 bump as A3.

## 8. Incremental, test-at-each-step migration plan

No big-bang. Each step is a small change plus the test that proves it. Steps 1-6 are
**behavior-preserving at contract v1** (the schema must validate the *current* goldens), so they
can land before A1/A3/A10. Steps 7-10 are the versioned (v2) changes that depend on the siblings.

The sequence respects the shared-surface rule (`agent-coordination.md`): any change to
`protocol.ts` / `wire.py` / golden / the two contract tests is coordinated, single-PR, both
sides + golden together.

1. **Add the Pydantic request/result models (no wire change).**
   Add `AgentRunRequest` / `AgentRunResult` Pydantic models in the SDK that compose the existing
   `dtos.py` sub-models with camelCase aliases, reproducing exactly what `request_to_wire` /
   `result_from_wire` emit/parse today.
   *Test:* a new unit test asserts `AgentRunRequest(...).model_dump(by_alias=True, exclude_none-ish)
   == request_to_wire(...)` for the Pi, Claude, and Agenta payloads (round-trip parity with the
   hand-built dicts and the goldens). Green before touching anything else.

2. **Export the JSON Schema artifact + a freshness test.**
   Add a script that writes `services/agent/contract/run-contract.schema.json` from
   `model_json_schema()`. Commit the artifact.
   *Test:* a CI test regenerates the schema in-memory and asserts it equals the committed file
   (drift -> fail), mirroring how the goldens are regenerated deliberately.

3. **Assert the existing goldens validate against the schema (Python side).**
   *Test:* load each of the four goldens, validate against `run-contract.schema.json`
   (`jsonschema`); all must pass. This proves the schema faithfully describes today's wire before
   anything consumes it. No production code path changes yet.

4. **Add ajv validation in the runner, behind a permissive mode (TS side).**
   Add ajv (one dependency) and load `run-contract.schema.json`. Validate the `/run` body in
   `server.ts`/`cli.ts`; in this step, on failure **log and continue** (permissive) so nothing
   breaks, and assert the goldens validate.
   *Test:* `wire-contract.test.ts` validates the goldens through ajv (must pass) and validates a
   deliberately-malformed payload (must report the right error path) — without yet rejecting it.

5. **Flip the runner to reject malformed requests (the boundary guard) — at v1 error shape.**
   Change permissive -> reject: a present-but-malformed body is rejected with a `400`. **Ordering
   subtlety (a real review catch):** at this point the result `error` is still the v1 free string
   (`protocol.ts` `error?: string`), so this step must NOT emit the structured `{error:{code:...}}`
   shape yet — emitting structured errors before the v2 error model lands would itself be a
   contract change. So the v1 rejection returns a **string** error
   (`{ok:false, error:"invalid_request: sandboxPermission.network.mode: must be one of ..."}`),
   carrying the code as a stable prefix. The structured object replaces it in step 8. An empty
   body still parses to a valid default request. Keep `additionalProperties` permissive (unknown
   top-level keys logged, not rejected) for cross-version safety.
   *Test:* `server.test.ts` asserts a malformed `/run` -> `400` with the `invalid_request:` prefix;
   an empty body -> still runs; the goldens -> still accepted. CLI test mirrors via exit code.

6. **Replace the duplicated key lists with schema-derived guards (+ a deeper-than-keys check).**
   Swap the two hand-kept `KNOWN_REQUEST_KEYS` for: (Python) derive the allowed key set from the
   schema's `properties`; (TS) drive the guard list from the schema property names so it cannot
   silently fall behind. **But a key guard alone is not enough** (review catch): it misses
   *nullability* drift — the Claude golden sends `sessionId: null` / `trace: null` while
   `protocol.ts` types them `?: string`. Add a schema-derived check that compares each field's
   nullability/optionality against the TS types (or, if sub-option b2 was chosen, generate
   `protocol.ts` from the schema so the check is structural).
   *Test:* `set(schema.properties) == set(KNOWN_REQUEST_KEYS)` on both sides, plus a nullability
   assertion (`sessionId`/`trace` accept `null`). **End of the behavior-preserving phase: the
   hand-maintained key lists are gone and the runtime guard is the schema. The TS *types* are
   either generated (b2) or guarded deeper than keys (b1); the omit-when-empty serializer behavior
   is still asserted by the goldens, not by the schema.**

   --- the steps below are the v2 contract changes; they depend on the siblings ---

7. **Add `contractVersion` in-band + consume the version on BOTH transports (with A1).**
   Add optional `contractVersion` (additive, still v1-compatible) to the request/result schema;
   service stamps it. Consume it on **both** transports, not only `/health` (review catch: the
   backend picks HTTP *or* subprocess in `adapters/sandbox_agent.py`, and the CLI has no health
   mode): the HTTP path probes `GET /health.protocol` once; the **subprocess/CLI path** gets a
   `--version`/`--protocol` mode (or reads the in-band `contractVersion` echoed on the first
   result) so a skewed CLI runner is also refused.
   *Test:* a transport test stubs an incompatible `/health` major and asserts the HTTP adapter
   refuses before `/run`; a CLI test asserts the subprocess version probe refuses an incompatible
   major; a schema test asserts `contractVersion` round-trips.

8. **The v2 cut: structured error model + cancelled outcome (A10) AND the A3 removal, together.**
   These are **two breaking changes**, so they ship as **one `PROTOCOL_VERSION = 2` cut**, not as
   two steps each calling itself "v2" (review catch: a second breaking change after a bump is not
   incremental — bump once, change once). In this single cut:
   - Result `error` becomes `{code, message, retryable}`; `result_from_wire` reads both the new
     object and the old v1 string (string -> `{code:"internal", message:str}`) for read-compat
     against an older runner. The step-5 `invalid_request:`-prefixed string rejection becomes the
     structured object.
   - Cancellation: cooperative cancel emits the terminal `{ok:false, error:{code:"cancelled"}}`;
     transport-teardown cancel maps to a distinct Python `CancelledError` outcome (per §7 A10).
   - A3: drop `backend` from the schema/models/goldens/guards; rename the `harness` enum to
     `pi_core | pi_agenta | claude`; update `version.ts` `HARNESSES`.
   - **Sequencing within the cut is itself incremental and test-guarded:** land read-compat error
     parsing first (no behavior change), then flip the emitted shape, then the A3 removal — each
     with its test green — but they release as one v2 because they share the breaking bump.
   *Test:* `test_wire_contract.py` parses an old-string-error golden and a new-structured golden;
   a runner test asserts cooperative cancel yields the terminal `cancelled` record and a disconnect
   yields the Python `CancelledError`; regenerated Pi/Claude goldens (no `backend`, renamed
   harness) assert the new shapes; a test asserts the schema rejects `backend` and the old
   `pi`/`agenta` harness values. New goldens: `run_result.cancelled.json`,
   `run_result.error_structured.json`. (If the team prefers to decouple, A3 can instead be a
   separate **v3** cut — but it must not share v2's bump.)

9. **Promote the capability probe: `GET /capabilities` (additive, can land any time).**
   Add the static per-harness `HarnessCapabilities` route to the runner. Define explicitly whether
   it returns **base** capabilities (what the harness supports at all) or **effective** ones (for a
   given request/mode) — `streamingDeltas` is mode-dependent today (review catch:
   `engines/sandbox_agent.ts` derives it at run time). Recommendation: return **base** capabilities
   from this static probe and document that mode-dependent flags are only authoritative in a run
   result. Optionally have the service pre-validate a request against the base capabilities.
   *Test:* `server.test.ts` asserts `GET /capabilities` returns the schema-valid base capability
   map per harness without running a turn; a schema test asserts the capability map validates.

After these steps: one schema source (dedicated Pydantic wire models) -> one exported artifact ->
runtime validation on both sides -> structured errors + a correctly-modeled cancelled outcome ->
in-band + both-transport contract version -> a real capability probe, with a test at every step
and no point where both sides are broken at once.

## 9. Risks and mitigations

- **Drift between `protocol.ts` types and the schema.** Mitigated by step 6's schema-derived guard
  (keys **and** nullability, or generated TS types) + step-4 ajv validation of the goldens; a drift
  fails `tsc` or a test.
- **An older runner against a newer service (or vice versa).** Mitigated by permissive
  `additionalProperties`, the read-compat error parsing (step 8), and the both-transport major
  probe (step 7).
- **The committed schema artifact going stale.** Mitigated by step 2's freshness test (regenerate
  == committed), the same discipline the goldens already use.
- **Sequencing against A1/A3/A10.** Steps 1-6 are independent and land first at v1; A10 + A3 are
  the **single** v2 cut (step 8); the version probe (7) and capability probe (9) are additive.
- **Standalone-package constraint.** Only one runner *runtime* dependency added (ajv); no runtime
  build step; the schema is loaded as data, honoring `services/agent/CLAUDE.md`. (If TS types are
  generated — sub-option b2 — that is a committed artifact produced by a script, not a build step.)

## 10. Open questions for review

1. **Wire models vs semantic DTOs, and where they live.** Confirmed direction: a **dedicated set
   of wire models** (not the snake_case semantic DTOs in `dtos.py`). Open: place them in a new
   `agents/wire_models.py` next to `dtos.py` (proposed) vs a dedicated contract package. Export the
   artifact into `services/agent/contract/`.
2. **TS types: hand-written + deep guard (b1) vs generated from the schema (b2).** Proposal: **b2
   (generate `protocol.ts`)** — a key guard misses nullability drift (`sessionId`/`trace` are
   `null` on the wire but `?:` in TS). If b1, the guard must compare nullability, not just keys.
3. **`additionalProperties` end state.** Stay permissive forever (log unknowns) or tighten to
   reject after the version probe is in place? Proposal: permissive for top-level request fields,
   strict for nested objects where a typo is more likely a bug than a version skew.
4. **Cancelled modeling.** Cooperative cancel -> terminal `error.code:"cancelled"`; transport
   teardown -> distinct Python `CancelledError` (proposed). Optionally also a `done`
   `stopReason:"cancelled"`. Needs A10 sign-off. `retryable` for cancel: `false`/omit.
5. **Version-cut grouping.** A10 + A3 as one v2 cut (proposed) vs A3 as a separate v3. A1 owns the
   final call on bump grouping.
6. **`contractVersion` granularity + transport coverage.** Single int major (proposed, matches
   `/health.protocol`) vs semver; and the subprocess/CLI version probe shape (`--protocol` flag vs
   in-band echo). A1 owns the granularity.
7. **Capability probe shape + base-vs-effective.** Return all harnesses (proposed) vs `?harness=`;
   and the probe returns **base** capabilities (proposed), with mode-dependent flags
   (`streamingDeltas`) authoritative only in a run result.

## 11. Review

This plan was reviewed by Codex (gpt-5.5, xhigh, read-only) on 2026-06-24. It verified the claims
against the code and the verdict ("Option B is the right direction, but ...") drove six concrete
corrections now folded in: (1) source from dedicated **wire** models, not the snake_case semantic
DTOs; (2) a key guard misses **nullability** drift — generate TS types or test deeper; (3) A10 and
A3 are **two** breaking changes -> one v2 cut (or A3 as v3), not two "v2" steps; (4) step 5 cannot
emit the structured error shape while v1 still types `error` as a string; (5) the version probe
must cover the **subprocess/CLI** transport, not only `/health`; (6) cancellation via a terminal
record only works for **cooperative** cancel — a disconnect maps to a Python `CancelledError`.
Also expanded the error taxonomy (`auth_error`/`quota_exceeded`/`rate_limited`/
`configuration_error`/`permission_denied`, which `engines/sandbox_agent/errors.ts` already
classifies) and added the base-vs-effective capability distinction.
