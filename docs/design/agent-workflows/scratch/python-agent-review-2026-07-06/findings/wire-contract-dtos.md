# Python agent review — B. Wire contract and DTOs

Reviewer: B (wire contract). Scope: `sdks/python/agenta/sdk/agents/dtos.py` (1232),
`wire_models.py` (517), `utils/wire.py` (192), `capabilities.py` (238), `utils/ts_runner.py`
(258, request/result framing only), the shared golden fixtures at
`sdks/python/oss/tests/pytest/unit/agents/golden/`, `test_wire_contract.py` (814) and
`test_wire_models.py` (122), read against the runner mirror `services/runner/src/protocol.ts`
(569) and its contract test `services/runner/tests/unit/wire-contract.test.ts`. Producer-side
anchors verified in `tracing.py`, `platform/gateway.py`, `mcp/models.py`, `skills/wire.py`,
`adapters/sandbox_agent.py`. Both Python contract test files were run: 48 passed.

---

## 1. How it actually works (verified against code)

**The request path.** One production call site builds the `/run` body:
`SandboxAgentSession._wire_payload` (`adapters/sandbox_agent.py:85-96`) calls
`request_to_wire` (`utils/wire.py:78-155`). The serializer is a hand-built dict. A fixed
head (`harness`, `sandbox`, `sessionId`, `agentsMd`, `model`, `messages`, `secrets`,
`context`, `telemetry`) is followed by dict-spreads of per-harness fragment emitters on the
config object: `wire_tools()`, `wire_prompt()`, `wire_mcp()`, `wire_skills()`,
`wire_sandbox_permission()`, `wire_model_ref()`, `wire_resolved_connection()`,
`wire_harness_files()` (`wire.py:138-146`). Those emitters live on `HarnessAgentTemplate`
and its three subclasses in `dtos.py:649-929`. `runContext`, `turnId`, `projectId` are
appended conditionally (`wire.py:147-155`). The transport (`utils/ts_runner.py`) POSTs the
dict to the runner's `/run` route over HTTP NDJSON streaming (`ts_runner.py:175`) or feeds
it to the runner CLI subprocess with `--stream` (`ts_runner.py:199-258`). The one-shot
transports (`ts_runner.py:57-149`) are marked DEV-ONLY and are off the live path.

**The result path.** The stream yields `{"kind":"event"}` records and one terminal
`{"kind":"result"}` record; `result_from_wire` (`wire.py:158-192`) parses the terminal body.
It raises `RuntimeError` on `ok: false` after sanitizing the error string
(`sanitize_runner_error`, `wire.py:54-75`: first line only, stack-frame patterns stripped,
300-char cap, full text logged). Messages and events parse tolerantly: a dict without
`role` or an event without `type` is silently dropped (`dtos.py:303-313`, `dtos.py:341-345`);
`usage` passes through as a raw dict (`dtos.py:530`); capabilities are hand-mapped from
camelCase with `bool()` coercion (`dtos.py:173-192`).

**The three mirrors, plus the guard network.** The contract exists in three definitions:
`protocol.ts` (TS types, erased at runtime), `utils/wire.py` (the hand-built producer), and
`wire_models.py` (a second Pydantic mirror whose only job is to emit JSON Schema into
`CATALOG_TYPES` via `run_contract_schemas()`, `wire_models.py:499-517`). The guard network
around them is dense and, for the paths it covers, genuinely strong:

- Shared golden fixtures (`run_request.pi_core.json`, `run_request.claude.json`,
  `run_result.ok.json`, `run_result.error.json`, `permission_decisions.json`) asserted
  byte-for-byte by Python (`test_wire_contract.py:241-243, 381-383`) and loaded by the TS
  test (`wire-contract.test.ts:72-83`).
- A hand-kept key list `KNOWN_REQUEST_KEYS` in the Python test
  (`test_wire_contract.py:49-77`), mirrored in TS (`wire-contract.test.ts:34-63`) where a
  compile-time assignment to `(keyof AgentRunRequest)[]` fails `tsc` on drift
  (`wire-contract.test.ts:66-67`).
- A schema-side guard: the exported request schema's property set must equal
  `KNOWN_REQUEST_KEYS` (`test_wire_models.py:71-75`), the committed catalog entry must
  equal a fresh export (`test_wire_models.py:52-58`), every golden must validate against
  the schema, and every `request_to_wire` output must validate and round-trip through
  `WireRunRequest` (`test_wire_models.py:109-114`).

**What is deliberately NOT there.** `wire_models.py:20-25` states the models are "NOT a
runtime guard": nothing validates a live `/run` in either direction, there is no contract
`version` field, and the result error is a free string. The runner parses the body as a
cast (runner review, A-7). The SDK never probes `/health` and still posts the deprecated
`/run` alias (see B-2).

**The trace/telemetry restructure is real and landed.** `TraceContext`
(`dtos.py:357-403`) is one capture serialized into two role-separated wire objects:
`context.propagation` (W3C `traceparent`/`baggage`, per-call protocol context) and
`telemetry.capture` + `telemetry.exporters.otlp` (operator config and policy, with the
credential nested under the exporter's `headers.authorization`). `protocol.ts:36-72`
mirrors it with matching role commentary. The pi_core golden pins the shape. This is the
interface-by-semantic-role discipline applied correctly, and it post-dates the runner
review's A-1 write-up: the single `trace` bucket the runner review describes is gone.
What has NOT changed is the deeper half of A-1: the value inside
`telemetry.exporters.otlp.headers.authorization` is still the caller's Agenta bearer, and
the runner still digs it out as its platform credential (see B-1).

**Doc/comment drift found.** The lane's own files still point at the runner's old home
`services/agent/`: `wire.py:4`, `wire_models.py:5`, `dtos.py:212`, `skills/wire.py:5`,
`interfaces.py:239`, `adapters/claude_settings.py:56-58`, `test_wire_contract.py:4` (the
runner lives at `services/runner/`; its own `CLAUDE.md` still says "from services/agent"
too). Within the mirrors themselves: `wire_models.py:252` documents a `builtin` executor
kind that `protocol.ts:135` does not admit; `wire_models.py:296` declares an
`McpServer.headers` field no producer emits and the TS side explicitly documents as
nonexistent ("Remote (http) carries no auth on the wire by design", `protocol.ts:232-233`);
`WireRenderHint` (`wire_models.py:223-227`) pins a two-field shape while `protocol.ts`
carries a four-variant union and says "wire.py does not pin RenderHint"
(`protocol.ts:305-313`). Details in B-5.

---

## 2. Strengths — keep this

- **The golden-plus-key-guard network is the best hand-built contract guard in the repo.**
  Byte-level goldens asserted by both languages, a compile-time `keyof` guard on the TS
  side, and a schema-property-set equality check on the Python side
  (`test_wire_models.py:75`) mean a one-sided field change cannot land silently. The
  freshness test (`test_wire_models.py:52-58`) stops the shipped catalog schema from
  drifting from the models. All 48 tests pass today.
- **The trace/telemetry role split.** `context` / `telemetry` / `runContext` are three
  correctly-separated role buckets (per-call propagation, operator config, the run's own
  resource identity), with standard names (`traceparent`, `authorization`) kept verbatim
  and the exporter credential nested under the thing it authenticates
  (`dtos.py:381-403`). The deliberate snake_case island inside `runContext` (the
  `$ctx.<dotted.path>` binding namespace) is documented identically on both sides
  (`dtos.py:466-474`, `protocol.ts:178-181`). This is textbook.
- **Omit-when-empty discipline, pinned.** Every extension field (`skills`, `mcpServers`,
  `sandboxPermission`, `runContext`, `harnessFiles`, `provider`/`connection`,
  `turnId`/`projectId`) is omitted when unset so an old-style payload stays byte-identical,
  and each omission has its own test (`test_wire_contract.py:230-238, 312-334, 703-735`).
  This kept the contract additive through at least six feature slices.
- **Error hygiene at the boundary.** `sanitize_runner_error` (`wire.py:54-75`) and
  `_transport_error` (`ts_runner.py:35-44`) enforce one rule in one place: the caller sees
  a clean line, the log gets the full detail. The 500-with-result-body recognition
  (`ts_runner.py:88-104`) preserves the actionable provider message instead of collapsing
  it to "HTTP 500". Both are well-tested (`test_wire_contract.py:586-630`).
- **The `harnessFiles` seam.** Per-harness translation happens in Python
  (`ClaudeAgentTemplate.wire_harness_files`, `dtos.py:897-921`) and the runner stays a dumb
  writer. This is the pattern the runner review (A-4) wants everything to converge on, and
  the wire side of it is done right here, including the byte-identical-when-empty rule.
- **Fail-loud stream termination.** Both streaming transports refuse to end without a
  terminal result record (`ts_runner.py:195-196, 244-254`), which is exactly the
  silent-blank-turn class of bug this codebase has fought.
- **The docstrings carry the why.** Nearly every field and every odd shape (the
  `call` XOR `callRef` rule, the `model`/`model_ref` split, why `wire.py` stays a hand
  dict) cites its design doc or incident. A reviewer can reconstruct intent everywhere.

---

## 3. Findings

Severity: blocker / high / medium / low. Horizon: **short** = before/at launch,
**medium** = 1-2 months, **long** = structural.

---

### B-1 (HIGH, short→medium) — Confirmed producer of runner A-1: the caller's Agenta bearer rides the wire as telemetry config, and a second copy rides `toolCallback`

**Where (producer side):** `tracing.py:59-75` builds `TraceContext` with
`authorization=headers.get("Authorization")`, the caller's own credential re-emitted by
`inject()` from `TracingContext.credentials`. `dtos.py:391-403`
(`telemetry_to_wire`) nests it under `telemetry.exporters.otlp.headers.authorization`;
`wire.py:137` puts it on the request. The runner then extracts it as its platform
credential (`services/runner/src/server.ts:123-126`) and recovers the Agenta API base by
slicing the OTLP endpoint on `"/otlp/"` (`server.ts:128-135`). Separately, the SAME
caller credential is packed into `toolCallback.authorization`
(`platform/gateway.py:204-206`, `platform/workflow.py:107`, `platform/platform_tools.py:119`),
which the runner reuses for direct-call tools (`protocol.ts:119-127`).

**What:** Runner A-1 is confirmed from the Python side, with one refinement. The wire
SHAPE was fixed since the runner review: the credential now sits under the exporter's
standard `authorization` header, which is the correct place for an *exporter* credential.
The role misclassification that remains is about the VALUE, not the shape: this is not a
scoped exporter token, it is the caller's reusable platform bearer, doing double duty as
the runner's session/mount/heartbeat credential and (via `toolCallback`) the tool-dispatch
credential. Turning off tracing on a run would still strip the runner of the credential it
needs for sessions and mounts, features unrelated to tracing. The Python docs are also
internally inconsistent about this: `tracing.py:45-48` states the dual use plainly ("the
runner authenticates its session-coordination calls AS the caller with it"), while the
`TraceContext` and `WireTelemetry` docstrings (`dtos.py:391-395`, `wire_models.py:154-158`)
describe a pure telemetry credential. A reader of the contract files cannot see that the
runner authenticates back to Agenta at all.

**Failure scenario:** an operator sets capture off and points the OTLP exporter at their
own collector (a legitimate telemetry reconfiguration). The runner now heartbeats and signs
mounts with the operator's collector token, or with nothing. Session-owned runs break with
no error that names the real cause.

**Recommendation:** this is the producer half of the fix runner A-1 specifies. Add a
first-class `platform: {endpoint, authorization}` block: one new field in
`request_to_wire`, `WireRunRequest`, `protocol.ts`, the goldens, and both key lists,
emitted alongside the telemetry copy for one release. Source it in `tracing.py` (or better,
in the service) explicitly rather than via `inject()`'s header re-emit. Fold
`toolCallback.authorization` into it in the same pass or the next (the endpoint stays on
`toolCallback`; the credential moves). Fix the `TraceContext`/`WireTelemetry` docstrings
now (one line each) so the dual role is visible where the contract is read. Keeping the
caller bearer out of the agent-readable environment is lane C / runner F2 territory; the
wire block is the prerequisite.

**Horizon:** short for the docstrings and the single-source accessor; medium for the wire
field (coordinated golden change).

---

### B-2 (HIGH, short) — Confirmed runner A-7: no `/health` probe, no protocol check, still posting the deprecated `/run` alias

**Where:** `ts_runner.py:66` and `ts_runner.py:175` build the URL as
`base_url.rstrip("/") + "/run"`. `/stream` is the productized route and `/run` is "kept as
a back-compat alias" (`services/runner/src/server.ts:320-324`). A grep across
`sdks/python/agenta/sdk/agents/` finds no call to `/health` and no protocol-version check
anywhere. The request carries no version field, deferred explicitly
(`wire_models.py:24-25`). `SandboxAgentBackend` also re-reads
`AGENTA_RUNNER_TIMEOUT_SECONDS` independently of the transport module
(`adapters/sandbox_agent.py:137` vs `ts_runner.py:16`), the duplication runner A-14 noted.

**What/why:** the runner ships a versioning surface built for exactly this client
(`version.ts`: `/health` returns `{protocol, engines, harnesses}` "so a client can detect
an incompatible runner before the first run") and the client ignores it. On skew, an old
runner silently ignores new fields (the F-032 silent-drop class) and the deprecated-alias
promise ("one release") has no mechanism enforcing it: when the runner deletes `/run`,
every SDK run fails with a generic 404 transport error.

**Failure scenario:** Helm tags the runner image independently
(`agentRunner.image.tag`). A newer SDK emits a field the older runner does not know
(say, a future `platform` block from B-1); the runner ignores it; session coordination
silently authenticates with the legacy telemetry copy until that is removed, then breaks
with no version diagnostic anywhere.

**Recommendation:** in `SandboxAgentBackend.__init__` (or first use, cached per instance),
GET `/health` when a URL is configured; log a warning on `protocol` mismatch and fail with
a clear message on an unsupported major. Switch both URL builders to `/stream` in the same
change. Add `protocolVersion` to the request when the contract next changes deliberately.
This is a ~30-line change plus one test against `_fake_runner_backend`.

---

### B-3 (HIGH, short) — The subprocess streaming transport can deadlock: stderr is piped but never drained during the run

**Where:** `ts_runner.py:212-243`. `deliver_subprocess_stream` spawns the runner CLI with
`stderr=asyncio.subprocess.PIPE` (`ts_runner.py:219`) and then reads only `stdout` in the
loop (`ts_runner.py:234`). `stderr` is read exactly once, after EOF, and only on the
no-terminal-result path (`ts_runner.py:247-249`).

**What/why:** the runner logs operational prose to stderr from every subsystem
(`[sandbox-agent]`, `[sessions]`, `[HITL]`; runner review A-18). An OS pipe buffer is
~64KB. Once the child has written 64KB of stderr with no reader, its next stderr write
blocks, the harness loop stalls, stdout goes quiet, and the Python side sits in
`readline` until the 180s deadline, then kills the child and reports a timeout. The run's
work is lost and the reported error ("stream timed out") points away from the real cause.
The subprocess transport is the default whenever no runner URL is configured
(`adapters/sandbox_agent.py:189-193`), i.e. the standalone-SDK and local-CLI path, a
shipped feature.

**Failure scenario:** a standalone SDK user runs a long agenta-harness turn with several
tool calls. The runner's per-event logging crosses 64KB of stderr mid-run. The turn hangs
at an arbitrary point and dies at 180s with "Agent runner stream timed out", reproducibly
on longer runs and never on short ones. This diagnoses as "flaky".

**Recommendation:** drain stderr concurrently: start a task that reads
`proc.stderr` into a bounded `deque` (keep the last ~2000 chars for the error detail the
code already wants at `ts_runner.py:247-253`). Alternatively pass a `stderr` tempfile.
While there: replace the bare `assert proc.stdin is not None` (`ts_runner.py:221`, stripped
under `-O`) with a check, and `await proc.stdin.drain()` after the write
(`ts_runner.py:222`) so a very large payload (inline skills, image blocks) cannot balloon
the write buffer.

---

### B-4 (HIGH, short) — An unrecognized permission default silently coerces to the MORE permissive `allow_reads`

**Where:** `dtos.py:1122-1129` (`_parse_run_selection`): a `runner.permissions.default`
value not in `PERMISSION_MODES` becomes `"allow_reads"` with no log and no error.

**What/why:** this is a policy field, and the failure direction is wrong twice over.
First, the coercion is silent: the author believes their setting took effect. Second, the
fallback is more permissive than three of the four valid values: a misspelled or
whitespace-padded `deny` (`" deny"` survives `.lower()` un-stripped and misses the set)
yields a run where every read-hinted tool executes without asking. The playground sends
enum values, but the template is user-authorable through the API and SDK directly
(`AgentTemplate.from_params` is a public parse), so free-string input reaches this code.
Note the contrast with the same file's own wire model: `WirePermissions.default` is a
strict `Literal` (`wire_models.py:283`); the authoring parse is the loose one.

**Failure scenario:** a customer writes `"default": "deny "` (trailing space, or
`"deny_all"`) in their agent template via the API. The parse silently produces
`allow_reads`. Their agent reads files and calls read-hinted Composio tools with no
approval prompt. Nothing anywhere records that the authored policy was not applied.

**Recommendation:** strip and lowercase, then fail loud on an unknown value (`ValueError`
at parse, surfaced as a 422 by the service), or if tolerant parsing must stay, coerce to
the most restrictive mode (`deny`) and log a warning. Never resolve an unparseable policy
to a more permissive one. One-line fix plus a test; do it before launch.

---

### B-5 (MEDIUM, short for the drift fixes; supports A-9 long) — The schema mirror has drifted above the real wire: phantom and partial fields in the published contract schema

**Where/what (each verified):**

- `WireMcpServer.headers` (`wire_models.py:296`) exists in the exported schema, but no
  producer emits it (`ResolvedMCPServer.to_wire`, `mcp/models.py:79-96`, has no headers)
  and the TS mirror deliberately excludes it: "Remote (http) carries no auth on the wire
  by design" (`protocol.ts:232-234`). The published schema advertises a credential channel
  that does not exist.
- `WireResolvedToolSpec`'s docstring names a `builtin` executor kind
  (`wire_models.py:252`) that `protocol.ts:135` does not admit (`"callback" | "code" |
  "client"`), and its `kind`/`runtime`/`permission` are free strings where TS has closed
  vocabularies.
- `WireRenderHint` (`wire_models.py:223-227`) pins `{kind, component}` while the TS
  `RenderHint` is a four-variant discriminated union including `source`, `spec`, and
  `connect`, and `protocol.ts:311-312` says explicitly that the Python side does NOT pin
  RenderHint. A partial pin is worse than no pin: it documents one variant as the shape.
- `WireSkill.description` and `.body` are optional (`wire_models.py:311-315`) where
  `protocol.ts:219-221` requires them; `WireToolCall.method` is a free string where TS is
  `"GET" | "POST" | "DELETE"` (`protocol.ts:129`).

**Why it matters:** this schema is not an internal artifact. It ships in the SDK through
`CATALOG_TYPES` and is resolvable by clients and the playground (`wire_models.py:12-15`,
`test_wire_models.py:43-49`). A client that authors to it will produce requests the system
silently mishandles. It is also the concrete evidence for runner A-9's thesis: the third
mirror has already drifted from the other two in five places, and the guard network cannot
catch this class of drift because `extra="allow"` plus all-optional means the goldens
validate regardless.

**Failure scenario:** an integrator reads the published `run_request` schema, sees
`mcpServers[].headers`, and sends their HTTP MCP server's auth header there. Every mirror
tolerates it; the runner never applies it; their MCP server rejects the unauthenticated
connection or, worse, serves an unauthenticated default. No error names the dropped field.

**Recommendation (short):** delete `WireMcpServer.headers`; fix the `builtin` mention;
either pin `RenderHint` fully as a discriminated union or replace `WireRenderHint` with an
explicitly opaque `Dict[str, Any]` plus a comment matching `protocol.ts:311-312`; align
`WireSkill` requiredness with what `skill_to_wire` actually emits; tighten `method` to the
TS vocabulary. Each is a one-line model change; the freshness test forces a deliberate
catalog regen. Then add the cross-mirror value-vocabulary golden runner A-9 recommends
(permission modes, executor kinds, render kinds, the `agenta-tools` constant) so
vocabulary drift fails a test instead of a review.

---

### B-6 (MEDIUM, medium) — Two absence conventions coexist on the wire, and they are what keeps the producer a hand-built dict

**Where:** `wire.py:123-137` emits the head fields unconditionally, so an unset value rides
as an explicit `null`: the claude golden carries `"sessionId": null`, `"context": null`,
`"telemetry": null`, and `toolCallback: null` rides whenever a harness has no callback
(`dtos.py:853-855`). Every field added since follows omit-when-empty instead
(`wire.py:147-155`, all the `wire_*` emitters). The runner treats null and absent
identically (every read in `protocol.ts` consumers is optional-chained).

**What/why:** the contract has no single answer to "what does absent look like", so every
new field decides again, and the docstring justification for the hand dict ("the
omit-when-empty behavior lives in this file, which `model_json_schema()` cannot express",
`wire.py:12-15`) is really a statement about this inconsistency: a uniform omit-when-unset
convention is exactly `model_dump(by_alias=True, exclude_none=True)`, at which point the
producer could BE the wire model and one mirror disappears. This is the cheapest
prerequisite of the A-9 migration and is worth doing on its own.

**Recommendation:** declare omit-when-unset the convention. Migrate the null-emitting head
fields (safe for the consumer today, since null and absent already read the same), regen
the goldens deliberately, and note the convention in one place (the `WireRunRequest`
docstring). Then evaluate collapsing `request_to_wire`'s fixed head into
`WireRunRequest(...).model_dump(...)` while keeping the per-harness fragment emitters as
the producer logic. Medium horizon; pairs with B-5 and precedes A-9.

---

### B-7 (MEDIUM, short) — Dead wire fields, defended by tests: `projectId` has no producer and no consumer; `turnId` has no Python producer

**Where:** `request_to_wire`'s only production caller is
`adapters/sandbox_agent.py:87-96`, which passes neither `turn_id` nor `project_id`
(verified by grep: no other caller in `sdks/`, `services/`, or `api/`). The runner reads
`request.turnId` only as an optional override before minting its own
(`server.ts:114-116`), and the runner review verified nothing reads `request.projectId` at
all (A-10), while `protocol.ts:496-500` still claims it rides heartbeats. Meanwhile four
Python tests (`test_wire_contract.py:337-378`) and both key lists pin the fields.

**What/why:** this confirms and extends runner A-10 from the producer side. `projectId` is
dead on BOTH ends of the wire, yet the contract machinery (goldens, key lists, schema,
tests in two languages) actively defends its existence, which is the worst state for a
contract field: maximal maintenance cost, zero function, and a false doc comment.
`turnId` is one-sided: consumed if present, never sent by this SDK; whichever future
caller it was reserved for is not documented on the Python side.

**Failure scenario (for the doc lie, not data):** an engineer implementing per-project
runner metering reads `protocol.ts:496-500`, assumes heartbeats carry the project id, and
builds aggregation on it; every heartbeat arrives without one.

**Recommendation:** remove `projectId` from the wire in one coordinated pass (drop from
`wire.py`, `wire_models.py`, `protocol.ts`, both key lists, the four tests), or implement
the documented heartbeat use, but not the current state. For `turnId`, add one sentence to
`WireRunRequest.turn_id` naming the intended producer (the coordination plane / a future
detached-run caller) so the asymmetry is deliberate on both sides.

---

### B-8 (MEDIUM, medium) — `dtos.py` fuses four concerns, and the layering leak is visible as a lazy adapter import inside the DTO layer

**Where:** `dtos.py` (1232 lines) contains: (1) neutral runtime DTOs (harness identity,
capabilities, content blocks, messages, events, results: roughly lines 43-535); (2) the
per-harness config classes with their wire-fragment emitters
(`HarnessAgentTemplate`/`Pi`/`Claude`/`Agenta`, lines 649-929); (3) the session bundle
(937-994); and (4) ~235 lines of request-parsing helpers "ported from the agent service's
inputs.py" (998-1232), which is config-parsing policy, not data shape. The leak:
`ClaudeAgentTemplate.wire_harness_files` imports `adapters.claude_settings` lazily inside
the method (`dtos.py:907-921`), with a comment explaining the import cycle it avoids. The
DTO layer calling upward into an adapter is the dependency arrow pointing the wrong way;
the documented cycle is the signal the class lives in the wrong module.

**Why it matters:** every contract change lands in this one file alongside parsing policy
and harness knowledge, so the review surface for "add a wire field" includes 1200 lines of
unrelated code. The harness config classes are exactly the per-harness knowledge the
architecture wants in `adapters/` (the module where `claude_settings.py` already lives),
and moving them dissolves the lazy import.

**Recommendation:** three-way split, mechanical: keep `dtos.py` as the neutral models;
move `HarnessAgentTemplate` and its subclasses to `adapters/harness_configs.py` (or into
`adapters/harnesses.py`) next to `claude_settings.py`, making the import direct; move
`from_params` plus the `_parse_*`/`_template`/`_section` helpers to a `parsing.py`.
Re-export from `dtos.py` for one release so callers are unaffected. Pairs with lane A's
A-14 work; medium horizon.

---

### B-9 (MEDIUM, short) — The shared vocabularies are defined five times, and the capability flags four times with a hand-map that fails silent

**Where (permission vocab):** `tools/models.py:31`, `utils/wire.py:39` (a second,
identical `Literal` in the same package), `dtos.py:109` (`PERMISSION_MODES` frozenset),
`wire_models.py:283` (inline `Literal`), `protocol.ts:75` (plus the runner's
`permission-plan.ts`). **Where (capability flags):** `dtos.py:154-192`
(`HarnessCapabilities` plus a hand-written camelCase map in `from_wire`),
`wire_models.py:346-359` (`WireHarnessCapabilities`, the same 11 flags with aliases),
`protocol.ts:275-287`, and the TS test's `keyof` capability guard
(`wire-contract.test.ts:241`).

**What/why:** adding one permission mode or one capability flag is a five-place edit with
no single point of failure detection for the values (the key guards cover top-level request
keys only). The capability hand-map is the sharp end: `from_wire` defaults every missing
key to `False`, so a flag added on the runner and in `wire_models.py` but forgotten in the
`from_wire` map parses as permanently `False` with no error, downgrading a real capability.

**Failure scenario:** the runner starts probing and reporting `imageGeneration: true`. The
flag is added to `protocol.ts` and `WireHarnessCapabilities`; the `from_wire` map at
`dtos.py:180-192` is missed. Every adapter that branches on the flag treats every harness
as incapable, silently skipping the feature that was just shipped.

**Recommendation:** define the permission vocabulary once (`tools/models.py`) and import it
in `wire.py`, `dtos.py`, and `wire_models.py` (derive `PERMISSION_MODES` via
`typing.get_args`). Replace `HarnessCapabilities.from_wire`'s hand map with
`WireHarnessCapabilities.model_validate(data)` and a `model_dump()` handoff, or generate
both from one field list, so a new flag is a one-place change on the Python side. Add the
vocab golden from B-5 to cover the cross-language values.

---

### B-10 (MEDIUM, short) — No exception taxonomy at the boundary: everything is `RuntimeError`, and one parse path bypasses the sanitizer

**Where:** run failure raises `RuntimeError` (`wire.py:166-168`); every transport failure
raises `RuntimeError` (`ts_runner.py:44, 132, 196, 231, 250`); a malformed NDJSON line
raises a raw `json.JSONDecodeError` carrying the raw line content
(`ts_runner.py:191, 239`), the only error path at this boundary that skips the
sanitize-and-log discipline.

**What/why:** callers cannot distinguish "the run failed and the message is
user-actionable" (missing provider key) from "the transport failed" (ops problem) from "the
contract broke" (deploy problem) without string matching. The package already demonstrates
the right pattern in `connections/errors.py` (a typed hierarchy). The unsanitized
`JSONDecodeError` is also an inconsistency: a garbled line's raw content (runner output,
potentially internal detail) rides the exception text straight to the caller.

**Failure scenario:** the playground error handler wants to show run failures verbatim but
mask transport failures; today it cannot, so it either leaks "Agent runner HTTP 502
<proxy detail>" classes or masks the actionable "add your Anthropic key" class.

**Recommendation:** three exception types (`AgentRunFailed(message)` carrying the sanitized
runner error, `RunnerTransportError`, `WireContractError`), all subclassing `RuntimeError`
for back-compat, raised at `wire.py:166` and the five `ts_runner` sites. Wrap the two
`json.loads(line)` calls to raise `RunnerTransportError("runner emitted a malformed stream
record")` with the raw line logged, not surfaced. Half a day including tests.

---

### B-11 (MEDIUM, medium) — Validation is tests-only by design, but the result side has typed-model gaps the tests cannot cover

**Where:** emit side: `request_to_wire` builds an unvalidated dict; the schema is
explicitly "NOT a runtime guard" (`wire_models.py:20-25`), and as a guard it is weak
anyway: all-optional plus `extra="allow"` means `additionalProperties` passes anything, so
only payload shapes exercised by a test are actually pinned. Parse side:
`result_from_wire` coerces tolerantly and drops silently (`dtos.py:303-313, 341-345`);
`usage` is an untyped pass-through (`AgentResult.usage: Optional[Dict[str, Any]]`,
`dtos.py:530`) even though the wire shape is fully known (`WireAgentUsage`,
`wire_models.py:362-368`; `protocol.ts:368-373`).

**What/why:** the deliberate POC scoping is documented and reasonable, but the untyped
`usage` is the same silent-drop class the runner review found on the TS side (cache-token
keys mismatched, cost data vanished, tracing finding 1): whatever dict arrives is rolled
onto the workflow span unchecked, so a renamed usage key zeroes cost/token reporting with
no error anywhere.

**Failure scenario:** a runner refactor emits `{"inputTokens": ...}` instead of
`{"input": ...}`. `result_from_wire` passes it through; the span rollup finds no `input`
key; token and cost metrics for every agent run read zero. Dashboards degrade silently;
no test on either side fails because the golden was not regenerated.

**Recommendation:** type `AgentResult.usage` (parse through `WireAgentUsage`, keep extras);
validate the terminal result record against `WireRunResult` behind a debug/env flag (on in
tests and the dev stack, off in prod until the runtime cost is measured); when B-1's
`platform` block or any next deliberate contract change lands, revisit
`extra="allow"` on the REQUEST model only (the producer owns that shape; the runner's
tolerant parsing does not require the SDK schema to under-specify what the SDK itself
emits). The result model should stay open (forward-compatible events are load-bearing,
`wire_models.py:376-391`).

---

### B-12 (LOW, short) — Stale `services/agent/` paths throughout the contract files (the Python tail of runner A-19)

**Where:** `wire.py:4`, `wire_models.py:5`, `dtos.py:212`, `skills/wire.py:5`,
`interfaces.py:239`, `adapters/claude_settings.py:56-58`, `test_wire_contract.py:4`; the
runner's own `CLAUDE.md` quickstart still says "from services/agent".

**What/why:** the runner lives at `services/runner/`. Every "go check the mirror" pointer
in the contract's own documentation sends the reader (or an agent run against this repo) to
a directory that does not exist. Given how much this contract's safety depends on humans
editing both sides together, the pointers should work.

**Recommendation:** one sed sweep plus a read-through, batched with the runner review's
A-19 docs pass. Half an hour.

---

### B-13 (LOW, medium) — `capabilities.py`: fail-open guards, hand-pinned model lists, an inconsistently applied alias, and a production-dead export

**Where/what:**
- `harness_allows_provider/_mode/_deployment` return `True` for a harness with no table
  entry (`capabilities.py:209-212, 221-224, 234-238`). Documented as deliberate ("a stale
  table should not break a new harness"), but it inverts the fail-loud doctrine the same
  module's docstring claims ("server-side fail-loud reject", `capabilities.py:7-9`): an
  unknown or typo'd harness string bypasses every connection-capability check and fails
  later, deeper, with a worse message.
- The model lists are hand-pinned to a moving target: `PI_SUBSCRIPTION_MODELS`
  (`capabilities.py:67-75`) mirrors Pi's vendored codex catalog "keep it in sync when the
  pinned Pi version changes", and `CLAUDE_MODEL_ALIASES` (`capabilities.py:83-92`) mirrors
  the runner's accepted alias set, both sync-by-comment. Drift shows the user a picker
  entry the harness rejects, or hides a model it supports.
- Claude's `deployments` carries both `"vertex_ai"` and `"vertex"` (`capabilities.py:162`)
  even though `harness_allows_deployment` normalizes `vertex → vertex_ai`
  (`capabilities.py:237`): the table compensates for a normalization that already exists,
  so the next writer cannot tell which spelling is canonical.
- `harness_capabilities_document` (`capabilities.py:170-185`) has no production caller
  (only its own tests; `harness_catalog_document` is the live one via
  `api/oss/src/resources/workflows/catalog.py:255,262`), the same test-defended-dead-code
  pattern as B-7.
- Naming: `HarnessConnectionCapabilities` (declared connection reach) and
  `dtos.HarnessCapabilities` (probed runtime features) are two unrelated concepts both
  called capabilities; every new reader pays the disambiguation tax.

**Recommendation:** make the unknown-harness case log a warning even if it stays
permissive (or fail loud once the harness id set is centralized per lane F / runner A-4);
add a unit test that pins `PI_SUBSCRIPTION_MODELS` against the pinned Pi package's catalog
export if importable, else a comment-anchored version marker; drop the redundant
`"vertex"` entry; delete or wire `harness_capabilities_document`; rename on the next
deliberate pass (e.g. `ConnectionReach`).

---

### B-14 (MEDIUM, long) — Field-role classification of the full request: the residual misclassifications after the trace/telemetry win

Classifying every top-level field of `WireRunRequest` by semantic role (data / config /
policy / credentials / routing / protocol-context / metadata):

| Role | Fields | Verdict |
|---|---|---|
| routing/selector | `harness`, `sandbox` | fine (flat selectors, documented) |
| protocol context | `sessionId`, `turnId`, `context.propagation`, `runContext` | good; `turnId` see B-7 |
| data | `messages` | good |
| model config | `model`, `provider`, `connection`, `deployment`, `endpoint`, `credentialMode` | **six flat top-level fields that are one concept** |
| credentials | `secrets`, `toolCallback.authorization`, `customTools[].env`, `mcpServers[].env`, `telemetry...authorization` | **five channels, three roles** (see below) |
| harness-scoped config in generic position | `systemPrompt`, `appendSystemPrompt`, `tools` | confirmed runner A-10 |
| config artifact | `agentsMd`, `skills`, `customTools`, `mcpServers`, `harnessFiles` | good |
| policy | `permissions`, `sandboxPermission`, `telemetry.capture` | good |
| telemetry config | `telemetry.exporters` | shape good, value misrole (B-1) |
| metadata (dead) | `projectId` | B-7 |

The findings this table yields beyond B-1/B-7:

- **The model group is flattened too early.** `provider`, `connection`, `deployment`,
  `endpoint`, `credentialMode` all answer "how do I reach the model" and change together
  (they all come from one `ResolvedConnection`, `dtos.py:793-807`); the interface rule says
  group them (`model: {name, provider, connection, endpoint, credentialMode}`). The
  flatness was a deliberate back-compat choice in the provider-model-auth slices and the
  "last spread wins" override of `model` by the resolved connection (`wire.py:107-110`,
  `dtos.py:799-803`) is the fragile edge it created: correctness depends on dict-spread
  ordering, pinned by exactly one test (`test_wire_contract.py:493-528`). Regroup on the
  next deliberate contract change (it can ride the same golden regen as B-1's `platform`
  block); until then, add a collision-check merge in `request_to_wire` so an unintentional
  key overwrite between fragment emitters fails loudly instead of silently winning by
  position.
- **Credentials ride five channels with three distinct roles**: provider keys (`secrets`,
  a free-floating top-level bag), per-tool and per-MCP-server secrets (`customTools[].env`,
  `mcpServers[].env`, correctly nested under the thing they configure), and the platform
  bearer twice (B-1). After B-1 lands, `secrets` is the one remaining free-floater; its
  natural home is under the model/connection group since they are provider credentials
  (the wire comment already says so: "Provider API keys as env vars, resolved from the
  vault", `protocol.ts:387`). Long horizon, cosmetic-but-clarifying.
- **`tools` misnames Pi builtin grants** (runner A-10 confirmed): `protocol.ts:439` says
  "Built-in tools to enable" while the runner interprets it as Pi-only grants and silently
  drops non-Pi names. Python emits `"tools": []` for Claude always (`dtos.py:889`). Fix
  the doc comment now (both sides); fold into a harness-scoped envelope with the
  `systemPrompt` pair at the next contract change.
- **What A-10 got that this side already fixed:** the permission default. Python ALWAYS
  emits `permissions.default` (`wire_permissions`, `dtos.py:713-719`; pinned at
  `test_wire_contract.py:549-557`), so the runner's `allow_reads` fallback is dead code for
  every SDK-produced request and only fires for hand-rolled callers. The policy owner is
  the Python side, as A-10 wants; the runner can demote its fallback to a refusal.

---

### B-15 (LOW, short) — The A-9 migration, costed from the Python end

Runner A-9 recommends a schema-first contract (zod authoritative in the runner, Python
generated). Evaluated from this side, the recommendation is right and the cost is modest,
BECAUSE the guard network makes each step verifiable:

1. **Normalize the absence convention** (B-6). Golden-visible, consumer-safe, ~1 day.
2. **Commit the runner-emitted JSON Schema as an artifact** (the cross-language handshake:
   the runner CI emits it from zod; the Python side vendors it the way it vendors the
   goldens). Assert `run_contract_schemas()` equals it. From that moment drift between
   `wire_models.py` and `protocol.ts` is impossible rather than reviewed. ~1 day.
3. **Generate the Pydantic mirror** (`datamodel-code-generator`) and diff it against
   `wire_models.py` in CI; when they match, delete the 517 hand-kept lines and the four
   hand-maps (`HarnessCapabilities.from_wire` goes with it, B-9). ~2 days.
4. **Optionally collapse `request_to_wire`'s fixed head into the generated model's
   `model_dump`** (possible only after step 1). The per-harness `wire_*` fragment emitters
   remain: they are producer logic (which fields THIS harness contributes), not schema, and
   they are the part worth keeping.

What does NOT get cheaper: the goldens and both key lists stay (they pin semantics, not
shape), and the runner gains runtime validation on its side, not this one. Total: roughly
a week of focused work, safely incremental, each step shippable. The right sequencing is
B-5's drift fixes now (they shrink the surface to migrate), B-6 next, the codegen after
launch. Agree with the runner review's "long" horizon for the full move.

---

### B-16 (LOW, short) — The third shipped harness has no golden: `pi_agenta`'s wire is pinned structurally only

**Where:** `_agenta_payload` is asserted field-by-field (`test_wire_contract.py:211-220`)
but not against a golden, and the TS contract test loads only `run_request.pi_core.json`
and `run_request.claude.json` (`wire-contract.test.ts:72`). The claude skills pin exists
precisely because that surface "regressed twice via merge-loss"
(`test_wire_contract.py:404-406`); the agenta harness, whose whole identity is forced
skills plus prompt overlays, has weaker protection than the other two.

**Recommendation:** add `run_request.pi_agenta.json` from `_agenta_payload` (extended to
carry a skill and the append-system overlay) and load it on both sides. Thirty minutes.

---

## 4. Top-10 priorities for the lane

1. **B-4** Stop the silent permissive coercion of an unknown permission default
   (`dtos.py:1122-1129`); fail loud or coerce restrictive. One line plus a test; before
   launch.
2. **B-3** Drain the subprocess transport's stderr concurrently
   (`ts_runner.py:212-249`); the standalone-SDK path hangs on chatty runs today.
3. **B-2** Probe `/health`, check `protocol`, switch to `/stream`
   (`ts_runner.py:66,175`); the versioning story finally gets its client (runner A-7).
4. **B-1** Land the `platform {endpoint, authorization}` wire block and fix the
   dual-role docstrings; stop overloading the exporter credential and
   `toolCallback.authorization` (producer half of runner A-1).
5. **B-5** Fix the five schema-mirror drifts (phantom `headers`, partial RenderHint,
   `builtin` kind, WireSkill requiredness, `method` vocab); the published catalog schema
   must not describe fields that do not exist.
6. **B-10** Typed exceptions at the boundary and sanitize the malformed-NDJSON path;
   callers need to tell run failure from transport failure.
7. **B-7** Delete (or implement) `projectId`; document `turnId`'s intended producer.
   Stop test-defending dead contract surface (with runner A-10).
8. **B-9** One definition each for the permission vocabulary and the capability flags;
   replace the silent-default capability hand-map; add the shared-vocab golden.
9. **B-6 → B-15** Normalize the absence convention, then run the incremental schema-first
   migration (commit the schema artifact, generate, delete `wire_models.py`); the
   three-mirror discipline is strong but already leaking, and the migration is about a
   week, safely staged.
10. **B-8** Split `dtos.py`: harness configs to `adapters/`, parsing helpers out, lazy
    import dissolved; plus **B-12/B-16** cleanups (stale `services/agent/` paths, the
    `pi_agenta` golden) batched into the same pass.

**Counts:** 0 blocker · 4 high (B-1, B-2, B-3, B-4) · 8 medium (B-5, B-6, B-7, B-8, B-9,
B-10, B-11, B-14) · 4 low (B-12, B-13, B-15, B-16).

**Reconciliation summary:** A-1 confirmed as producer (`tracing.py:59-75`,
`dtos.py:391-403`), with the refinement that the wire SHAPE was already fixed by the
trace/telemetry restructure and the remaining defect is the credential's dual role plus a
second copy on `toolCallback`. A-7 confirmed (`ts_runner.py:66,175`; no `/health` call in
the SDK). A-9 supported with Python-side drift evidence (B-5) and a costed migration path
(B-15). A-10 confirmed for `projectId` (dead both ends) and `tools`/`systemPrompt`
(harness-scoped fields in generic positions), and refined for the permission default:
Python always emits it (`dtos.py:713-719`), so the runner's fallback is already dead for
SDK-produced requests.
