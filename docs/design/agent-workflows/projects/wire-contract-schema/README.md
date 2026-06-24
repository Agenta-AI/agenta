# Project: A schema-driven `/run` contract

| | |
| --- | --- |
| **Status** | Plan. Revised per author PR review on #4830 (2026-06-24). Pre-production POC — any wire shape may change freely; no back-compat burden. |
| **Type** | Engineering project (a sequenced, test-driven change), not a one-shot change. |
| **Scope** | Replace the hand-mirrored `/run` wire contract with a single schema source (Pydantic for now); **ship the exported JSON interface in the SDK** and investigate whether Fern can see it; fold in a structured error model and a carried contract version. **No sidecar/runner validation yet** — the contract is still brittle. |
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
   "No schema validation on the runner". (Observed gap — but **not** fixed in this POC phase; a
   boundary guard is a deferred follow-up, Section 8.)
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

The fix for now is a **single source of truth** (Pydantic wire models) whose **JSON interface
ships in the SDK**, plus the A10 error model and a `/capabilities` probe — sequenced so each step
is a small change with a test that proves it. Boundary validation, generated TS types, and
versioning are **deferred** (the contract is still brittle; this is a pre-production POC). The
A3 rename (backend removal + `pi`->`pi_core` / `agenta`->`pi_agenta`) has already landed in the
working tree, so the wire models describe that current shape from the start.

## 2. What this project changes vs leaves alone

**In scope:**

- One schema as the source of truth for the `/run` request, result, event union, capabilities,
  and the sub-objects listed above. **Source = Pydantic for now** (Section 4).
- **The exported JSON Schema interface lives in the SDK** (alongside the existing `CATALOG_TYPES`
  JSON interfaces), and an investigation of whether Fern can see/generate it across languages
  (Section 4).
- A structured error object `{ code, message, retryable }` and a distinct `cancelled` outcome.
- A contract version carried in the payload (not only on `/health`), and a probe that consumes
  it.
- A decision on splitting `/run` (verdict: keep `/run` unified; promote a `/capabilities` probe).
- Replacing the four golden fixtures + two key lists with schema-derived checks **on the Python
  side** (the golden fixtures stay as *examples that must validate*, not as the only guard).

**Deliberately NOT in scope for now (the contract is still brittle):**

- **No request validation in the runner** (`server.ts` / `cli.ts`). We do not gate `/run` on the
  schema yet. The runner keeps parsing the body as it does today.
- **No use of the schema in the sidecar/runner at all.** No ajv, no new runner dependency, no
  runtime validation step on the Node side. The schema is an SDK-side artifact for now.
- These are deferred until the contract stabilizes; revisit when we want a hard boundary guard.

**Explicitly unchanged by this work** (called out so reviewers do not expect movement):

- **Composio, the tool gateway, connections, and MCP** all continue to work as today. They are
  inputs the service already resolves: `customTools` (gateway callback / code / client),
  `toolCallback`, `mcpServers`, `connection` / `provider` / `endpoint` / `credentialMode`. This
  project re-expresses their **shapes** in a schema; it does not change how any of them resolve,
  route, or authenticate. The Composio key stays server-side; the gateway callback still POSTs to
  `/tools/call`; the MCP `stdio`/`http` shapes are unchanged. (We may still adjust any of these
  shapes if the schema work surfaces a better one — this is a POC, not a frozen contract.)
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

Shape notes (the current serializer behavior, **not** a back-compat constraint — this is a
pre-production POC and any of these may change freely): a plain-string `model` keeps `provider` /
`connection` / `deployment` / `endpoint` / `credentialMode` off the wire; `mcpServers`, `skills`,
`sandboxPermission`, `harnessFiles` are omitted (not null) when empty. The schema describes
whatever shape we settle on; it does not exist to freeze today's bytes.

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
(`json-schema-to-typescript`) and Pydantic models (`datamodel-code-generator`) from them.

- **Pros:** language-neutral source; one artifact; both sides are generated, so neither drifts.
- **Cons:** introduces **two new codegen toolchains** into a repo that has none for this, and a
  build step into a package that intentionally has none (`services/agent/CLAUDE.md`: "no app
  compile step"). Hand-writing JSON Schema is verbose and error-prone for a union as rich as
  `AgentEvent` + `RenderHint`. The Python SDK already has hand-written BaseModels with custom
  `to_wire`/`from_wire` (camelCase aliasing, the `model`-string split, the drop-unknown-event
  behavior); regenerating them from schema would either lose that behavior or require post-gen
  patching. High blast radius, fights the existing grain. Also: it does not put the interface in
  the SDK the way the existing `CATALOG_TYPES` Pydantic-derived schemas already are (Section 4.1).

### Option B — Pydantic as source, export the JSON interface into the SDK (RECOMMENDED)

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
  toolchain. **This exported JSON interface ships in the SDK** — exactly the way the SDK already
  exposes Pydantic-derived JSON Schemas through `CATALOG_TYPES` (Section 4.1). The immediate goal
  is that the interface (the JSON) lives in the SDK; the runner does **not** consume it yet
  (Section 5).

- **Pros:** fits the stack — Pydantic 2 is already the SDK's modeling layer (`pydantic>=2,<3`);
  the producer (Python) is the natural source since it builds the request. Schema export is a
  built-in, not a new tool. It puts the interface in the SDK alongside the existing
  `CATALOG_TYPES` JSON interfaces (one consistent mechanism). The omit-when-empty behavior stays
  in Python where it already lives and is tested. The exported schema becomes a **CI-checked
  artifact**: a test fails if the committed schema drifts from the wire models.
- **Cons:** requires writing dedicated wire models (a real cost, but it is the honest cost of a
  single source — the alternative is the current double-maintenance). The TS `protocol.ts` stays
  **hand-written for now** — we do *not* generate it from the schema yet, because the runner does
  not consume the schema yet (Section 5) and the contract is still brittle. Keeping the schema and
  `protocol.ts` aligned stays a Python-side discipline for the moment (the Python goldens are the
  guard). Generating `protocol.ts` from the schema is a later option once the contract settles.

#### 4.1 The interface in the SDK, and whether Fern can see it

The author's direction: get this interface (the JSON Schema) **into the SDK** now, and find out
whether **Fern** can also see/generate it across languages. Findings, with concrete paths:

- **The SDK already exposes Pydantic-derived JSON interfaces.** `CATALOG_TYPES` in
  `sdks/python/agenta/sdk/utils/types.py` (line ~1265) is a dict of
  `model_json_schema()` outputs for `Message`, `Messages`, `AgentConfigSchema`,
  `SkillConfigSchema`, `PromptTemplate`, etc., each dereferenced. The agent workflow surfaces
  them through `/inspect` via thin `x-ag-type-ref` markers (`services/oss/src/agent/schemas.py`),
  and the playground resolves them against `GET /workflows/catalog/types/{type}`. **The wire
  contract should ship the same way:** add the exported `WireRunRequest` / `WireRunResult` JSON
  Schema next to `CATALOG_TYPES` (or as a sibling export) so the SDK is the single home of the
  JSON interface. This is the immediate, low-risk goal.

- **How Fern is used here.** Fern in this repo generates the multi-language API clients (Python +
  TypeScript) under `clients/` and `web/packages/agenta-api-client/`. The pipeline
  (`clients/scripts/generate.sh`) is: the FastAPI app (Pydantic models) emits **`/api/openapi.json`**
  → the script writes an ephemeral `fern.config.json` + `generators.yml` and runs the
  `fernapi/fern-python-sdk` and `fernapi/fern-typescript-sdk` generators against that OpenAPI
  spec. There is **no `.fern/` API-definition directory checked in** and no Fern IDL; Fern's only
  input is the generated OpenAPI document. So the chain is **Pydantic → OpenAPI → Fern → SDKs**.

- **Can Fern see this interface? Yes, but only via OpenAPI — with one real caveat.** Fern reads
  the OpenAPI spec, and that spec is built from the FastAPI/Pydantic models the *public API*
  exposes. The `/run` contract is the **service ↔ runner spine**, not a public FastAPI endpoint,
  so it does **not** appear in `openapi.json` today and Fern therefore cannot see it as-is. Two
  ways to make Fern see it, neither needed for the immediate goal:
  - **(a) Reference the wire models from a FastAPI surface.** If any endpoint (even an internal or
    `/inspect`-style descriptor) types a field with the wire Pydantic models, FastAPI emits their
    JSON Schema into `components/schemas` of `openapi.json`, and Fern then generates them in every
    client language. This is the same path `AgentConfigSchema` already takes to reach the clients.
  - **(b) Add a standalone OpenAPI fragment as a second Fern spec.** `generators.yml` takes a list
    under `api.specs`; a hand-authored fragment that `$ref`s the exported `run-contract.schema.json`
    could be added. Heavier and not worth it now.
  - **Blocker / reason not to do it yet:** the contract is still brittle (it changes often as the
    POC evolves), and putting it on the public OpenAPI surface would publish a moving target into
    every generated client. So **for now**: export the JSON interface into the SDK (the
    `CATALOG_TYPES`-style path), keep it out of the public OpenAPI spec, and let Fern pick it up
    later once it stabilizes. The path is clear and there is no hard blocker — only a timing call.

### Option C — A shared IDL (`.proto`, Smithy, etc.)

Define the contract in a neutral IDL and generate both sides.

- **Pros:** strongest neutrality; mature codegen.
- **Cons:** the heaviest option for an internal JSON-over-HTTP/stdio boundary. The wire is JSON,
  not protobuf; adopting proto means either proto-over-JSON (awkward) or changing the wire format
  (out of scope and risky). Brings a build toolchain and a new language into a two-language repo
  that wants fewer moving parts. The `AgentEvent` open-union + "drop unknown" semantics fit JSON
  Schema's `additionalProperties`/`oneOf` better than proto's closed messages. Overkill.

### Recommendation: Option B (Pydantic-as-source → exported JSON interface in the SDK)

Use **Pydantic as the source for now**. It fits the Pydantic 2 stack, keeps the custom
serialization semantics where they are tested, exports the JSON Schema for free, and **puts the
interface in the SDK** the same way `CATALOG_TYPES` already does — which is exactly the immediate
goal. Source of truth = dedicated Pydantic **wire** models (not the semantic DTOs); the exported
schema ships in the SDK as a CI-checked artifact (a test fails if it drifts from the wire models).

Two deliberate constraints from the author's review:

- **No runner/sidecar validation yet.** The runner does not load or validate against the schema;
  there is no ajv, no new runner dependency, no build step. The contract is still brittle, so we
  hold off on a hard boundary guard (Section 5).
- **`protocol.ts` stays hand-written for now.** We do not generate TS types from the schema yet
  (that only pays off once the runner consumes the schema). The Python goldens remain the guard.

Fern can reach this interface later through the existing **Pydantic → OpenAPI → Fern → SDKs**
pipeline once the contract stabilizes (Section 4.1); for now the interface lives in the SDK only.

## 5. Validation — deferred (no runtime guard yet)

Author's direction (PR review): **do not validate for the moment.** The contract is still
brittle, so this project does **not** add a runtime boundary guard on either side yet.

- **No runner ingress validation.** `server.ts` / `cli.ts` keep parsing the `/run` body exactly
  as today (empty body → defaults, unknown fields ignored). No ajv, no new runner dependency, no
  schema loaded on the Node side. A present-but-malformed body is still tolerated for now.
- **No runtime Python validation either.** `request_to_wire` / `result_from_wire` are not gated
  on the schema at runtime.

What the schema *is* used for in this phase is **Python-side tests only**: the exported schema
validates the existing goldens (an example-must-validate check) and can validate `request_to_wire`
output in a unit test, so the schema is proven faithful without changing any production code path.
That is the full extent of validation for now.

When the contract stabilizes, a real boundary guard (runner ingress validation + a symmetric
Python result check) is a natural follow-up — see Section 8 / Open questions. Until then it is
explicitly out of scope.

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

**DO formalize the probe — the author endorsed this in review ("that's a good idea with
capabilities").** `/health` already returns `{status, runner, protocol, engines, harnesses}` but
nothing consumes it, and `HarnessCapabilities` (per-harness, 11 flags) is only discoverable by
doing a full run. Recommendation:

- Keep `GET /health` as the cheap liveness + identity + **contract version** probe (it already
  carries `protocol`). This is what the A1 version check consumes (Section 7).
- Add `GET /capabilities` (or `GET /capabilities?harness=pi_core`) that returns the static **base**
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

### A3 — backend removal + harness rename (already landed in the working tree)

A3 removed the legacy in-process backend and the `backend` field, and renamed harness values
`pi -> pi_core` and `agenta -> pi_agenta`. This is **no longer "assumed end state"** — it is
already in the working tree (`version.ts` now declares `HARNESSES = ["pi_core","claude",
"pi_agenta"]`; the pi golden is renamed `run_request.pi_core.json`; `engines/pi.ts` is deleted).
So the schema simply describes that current shape:

- No `backend` field.
- `harness` is `pi_core` | `pi_agenta` | `claude`.

Because this is a **pre-production POC, we do NOT version the pi/agenta rename.** There is no v1→v2
cut for it, no downcaster, no `PROTOCOL_VERSION` bump tied to the rename — the wire just changes.
The wire models are authored against today's renamed shape from the start.

### A1 — versioning (coordinate: a simple string version, the LLM-as-judge style)

A1 is the sibling project [`../contract-versioning/`](../contract-versioning/) (it owns the
versioning strategy). Per the author's review, A1 is being simplified to **a plain string version
plus an if/else branch — the same pattern the codebase already uses elsewhere** (the
`x-ag-messages-version: "v1"` header and `VERCEL_MESSAGE_PROTOCOL_VERSION` string; the LLM-as-judge
string-version + if/else dispatch). **No `{major, minor}` struct, no `contractVersion` field name,
no upcaster/downcaster machinery.** This project defers to whatever simple string convention A1
lands on and reuses it verbatim (do NOT invent a new scheme).

It is still true that the runner advertises `protocol: 1` on `/health` (`version.ts`) but the
Python client (`ts_runner.py`) never reads it. If A1 wants the version carried on the payload, it
rides as the same simple string A1 chooses, stamped by the producer and branched on with a plain
if/else on the consumer. Skew handling and any negotiation are A1's call; this project only agrees
to carry the field A1 specifies in the wire models. Given the POC framing, even this is optional
for now.

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
  `unsupported_harness`, `auth_error`, `quota_exceeded`, `rate_limited`, `configuration_error`,
  `permission_denied`, `model_error`, `tool_error`, `mcp_error`, `sandbox_error`, `timeout`,
  `cancelled`, `internal`. The `auth_error` / `quota_exceeded` / `rate_limited` codes are not
  speculative: the runner already pattern-classifies these from provider error text in
  `services/agent/src/engines/sandbox_agent/errors.ts` — the schema just gives that classification
  a stable wire code. Keep the enum forward-compatible (an unknown code -> treat as `internal`),
  mirroring the event "drop unknown" tolerance. (No `invalid_request` /
  `unsupported_contract_version` codes for now — we are not validating requests or enforcing a
  version at the boundary in this phase.)
- **`retryable`** lets the caller distinguish a transient `timeout` / `rate_limited` / `mcp_error`
  from a permanent `unsupported_harness` / `auth_error` / `configuration_error`.
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
  structured object (parse a string into `{code:"internal", message:str, retryable:false}`). This
  read-compat is cheap and avoids a hard flag-day, but because this is a POC we do **not** treat
  the new error shape as a versioned cut — the wire just changes to the structured form.

This is a wire-shape change (the new structured error), made directly. No version bump is tied to
it (POC).

## 8. Incremental, test-at-each-step plan (POC-framed)

No big-bang, but no versioning machinery either — this is a pre-production POC, so the wire just
changes when it needs to. Each step is a small change plus the test that proves it. The
heaviest items (runner-side validation, generating `protocol.ts`, version negotiation) are
**deferred** until the contract stabilizes; they are listed at the end as follow-ups, not steps.

The sequence respects the shared-surface rule (`agent-coordination.md`): any change to
`protocol.ts` / `wire.py` / golden / the two contract tests is coordinated, single-PR, both
sides + golden together.

1. **Add the dedicated Pydantic wire models in the SDK (no wire change).**
   Add `WireRunRequest` / `WireRunResult` (and the discriminated `WireAgentEvent`) wire models in
   the SDK, with camelCase aliases, reproducing exactly what `request_to_wire` / `result_from_wire`
   emit/parse today (against the *current* renamed shape — `pi_core` / `pi_agenta`, no `backend`).
   *Test:* a unit test asserts `WireRunRequest(...).model_dump(by_alias=True, exclude-none-ish)
   == request_to_wire(...)` for the pi_core, claude, and pi_agenta payloads (round-trip parity with
   the goldens). Green before anything else.

2. **Export the JSON interface into the SDK + a freshness test.**
   Export `model_json_schema()` for the wire models and ship it in the SDK alongside the existing
   `CATALOG_TYPES` JSON interfaces (Section 4.1). Commit the artifact.
   *Test:* a test regenerates the schema in-memory and asserts it equals the committed export
   (drift -> fail), the same discipline the goldens already use.

3. **Assert the existing goldens validate against the exported schema (Python side, tests only).**
   *Test:* load each golden, validate against the exported schema (`jsonschema`); all must pass.
   This proves the schema faithfully describes today's wire. **No production code path changes, and
   nothing on the runner side** — validation here is a test, not a runtime guard (Section 5).

4. **Make the wire models the single producer.**
   Reimplement `request_to_wire` / `result_from_wire` in terms of the wire models, keeping the
   omit-when-empty serializer behavior. The goldens stay byte-identical (this is a refactor, the
   models already match the wire from step 1).
   *Test:* the existing golden wire-contract test stays green unchanged; add a parity test that the
   reimplemented serializers equal the old output.

5. **Replace the duplicated key lists with a schema-derived guard (Python side).**
   Swap the hand-kept Python `KNOWN_REQUEST_KEYS` for a set derived from the exported schema's
   `properties`, so the Python guard cannot silently fall behind. The TS `KNOWN_REQUEST_KEYS` guard
   in `wire-contract.test.ts` stays hand-written for now (we are not generating `protocol.ts` or
   touching the runner this phase).
   *Test:* `set(schema.properties) == set(python KNOWN_REQUEST_KEYS)`.

6. **Structured error model + cancelled outcome (A10).**
   Result `error` becomes `{code, message, retryable}`; `result_from_wire` also reads the old free
   string for read-compat (string -> `{code:"internal", message:str}`). Cancellation: cooperative
   cancel emits the terminal `{ok:false, error:{code:"cancelled"}}`; transport-teardown cancel maps
   to a distinct Python `CancelledError` (per §7 A10). This is a direct wire change — **no version
   bump** (POC).
   *Test:* `test_wire_contract.py` parses an old-string-error golden and a new-structured golden; a
   transport test asserts a disconnect yields the Python `CancelledError`. New goldens:
   `run_result.cancelled.json`, `run_result.error_structured.json`.

7. **Promote the capability probe: `GET /capabilities` (additive, the author endorsed it).**
   Add the static per-harness `HarnessCapabilities` route to the runner. It returns **base**
   capabilities (what the harness supports at all); mode-dependent flags (`streamingDeltas`, derived
   at run time in `engines/sandbox_agent.ts`) stay authoritative only in a run result. The service
   can pre-render UI / pre-check a request against the base set.
   *Test:* `server.test.ts` asserts `GET /capabilities` returns the base capability map per harness
   without running a turn.

### Deferred follow-ups (only once the contract stabilizes)

These are explicitly **not** in this phase, per the author's review:

- **Runner-side request validation.** Loading the schema in `server.ts` / `cli.ts` and rejecting a
  malformed `/run` (with ajv or similar). The contract is too brittle to gate on yet.
- **Generating `protocol.ts` from the schema.** Pays off only once the runner consumes the schema;
  until then `protocol.ts` stays hand-written and the Python goldens are the guard.
- **A version field + negotiation.** Owned by A1; if/when it lands it is a simple string version +
  if/else (Section 7 A1), not a `{major, minor}` or upcaster/downcaster scheme.
- **Fern generating the interface across languages.** Reachable later via Pydantic → OpenAPI → Fern
  once the contract is stable enough to publish into the clients (Section 4.1).

After this phase: one Pydantic wire-model source -> the JSON interface shipped in the SDK ->
structured errors + a correctly-modeled cancelled outcome -> a real capability probe. No runner
validation, no version machinery, no generated TS types — those are deferred until the contract
settles.

## 9. Risks and mitigations

- **Drift between `protocol.ts` types and the schema.** While `protocol.ts` stays hand-written and
  the runner does not consume the schema, this drift is tolerated as a POC trade-off. The Python
  goldens + the schema-derived Python key guard (step 5) catch Python-side drift; aligning the TS
  types is a manual discipline for now. Generating `protocol.ts` is the deferred fix.
- **The committed schema export going stale.** Mitigated by step 2's freshness test (regenerate ==
  committed), the same discipline the goldens already use.
- **Sequencing against A1.** A1 owns the version convention (a simple string + if/else); this
  project only carries whatever field A1 specifies. The error model (step 6) and capability probe
  (step 7) do not depend on A1.
- **No boundary guard means typos still pass silently.** Accepted for now — the contract is too
  brittle to gate on. The runner keeps today's behavior. Revisit with the deferred runner-side
  validation once the contract stabilizes.

## 10. Open questions for review

1. **Wire models placement.** A new `agents/wire_models.py` next to `dtos.py` (proposed) vs a
   dedicated contract package. The exported JSON interface ships in the SDK alongside
   `CATALOG_TYPES`.
2. **Where exactly the exported interface is surfaced in the SDK.** As an entry in (or sibling of)
   `CATALOG_TYPES` in `sdks/python/agenta/sdk/utils/types.py`, vs a standalone export. Either keeps
   it SDK-resident; the `CATALOG_TYPES` path also makes it `/inspect`-discoverable.
3. **Cancelled modeling.** Cooperative cancel -> terminal `error.code:"cancelled"`; transport
   teardown -> distinct Python `CancelledError` (proposed). Optionally also a `done`
   `stopReason:"cancelled"`. `retryable` for cancel: `false`/omit.
4. **Capability probe shape + base-vs-effective.** Return all harnesses (proposed) vs `?harness=`;
   and the probe returns **base** capabilities (proposed), with mode-dependent flags
   (`streamingDeltas`) authoritative only in a run result.
5. **The deferred follow-ups (Section 8).** Confirm runner-side validation, generated `protocol.ts`,
   the version field, and Fern publication are all out of scope for this POC phase.

## 11. Review

This plan was reviewed by Codex (gpt-5.5, xhigh, read-only) on 2026-06-24, then revised on
2026-06-24 per the author's PR review on #4830. The author's direction simplified it toward the POC
reality:

- **No back-compat burden** — this is still an internal POC, so any wire shape may change freely
  (the "must preserve the model/connection split" framing was dropped).
- **Pydantic as the source for now**, with the immediate goal that the exported JSON interface
  lives **in the SDK** (the `CATALOG_TYPES` path), plus a Fern investigation (Section 4.1): Fern
  here is driven by Pydantic → OpenAPI → Fern → SDKs, so it can see this interface later via the
  OpenAPI surface once the contract stabilizes — no hard blocker, only a timing call.
- **No sidecar/runner validation yet** (no ajv, no new runner dependency) — the contract is still
  brittle (Section 5); `protocol.ts` stays hand-written for now.
- **No versioning machinery** — the pi/agenta rename (already landed) is not versioned, and any
  version field defers to A1's simple string + if/else convention.
- **Keep `/capabilities`** — the author endorsed the probe.

Codex's earlier structural catches that survive the simplification: source from dedicated **wire**
models (not the snake_case semantic DTOs); cancellation via a terminal record only works for
**cooperative** cancel (a disconnect maps to a Python `CancelledError`); the error taxonomy is
grounded in what `engines/sandbox_agent/errors.ts` already classifies; capabilities are
base-vs-effective. The corrections that were about versioning/validation (two-breaking-changes-one-
cut, the step-5 error-shape ordering, the both-transport version probe) are **moot** now that
versioning and runner validation are deferred.
