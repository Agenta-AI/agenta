# Runner review — A. Architecture, responsibilities, boundaries

Reviewer: A (system-level). Scope: the runner as a system — responsibility split across
SDK/service/runner, subsystem boundaries, the `/run` wire contract, the engine abstraction,
extensibility, scalability/operability, and target structure. Subsystem internals (engine
correctness, tools/permissions security, tracing state machine, tests, TS idioms) belong to
reviewers B–G; where I touch them it is only to make a structural point.

Date: 2026-07-05. Verified against code at `services/runner/src/`,
`services/oss/src/agent/`, `sdks/python/agenta/sdk/agents/`, `hosting/docker-compose/`,
`hosting/kubernetes/helm/`.

---

## 1. How the system actually works (verified, with doc drift noted)

**The pipeline.** The playground/API calls the Python agent service
(`services/oss/src/agent/app.py`, 316 lines), which mounts `/invoke` as an Agenta workflow.
The service parses the agent config, resolves tools/MCP/secrets/connections server-side,
and calls SDK primitives (`agenta.sdk.agents`). The SDK assembles a camelCase JSON
`AgentRunRequest` (`utils/wire.py` + per-harness `wire_*()` fragments in `dtos.py`) and
POSTs it to the Node runner sidecar — over HTTP when `AGENTA_RUNNER_INTERNAL_URL` is set
(the deployed path, `http://runner:8765`), else as a one-shot subprocess
(`pnpm exec tsx src/cli.ts`). The live path is always NDJSON streaming
(`Accept: application/x-ndjson`); the SDK folds the stream into the batch result.

**Inside the runner** there is exactly ONE engine: `runSandboxAgent`
(`src/engines/sandbox_agent.ts:317`). It builds a `RunPlan`
(`engines/sandbox_agent/run-plan.ts`), boots the `sandbox-agent` daemon on one of two
sandbox backends (`local` = child process on the sidecar host, `daytona` = remote cloud
sandbox), creates an ACP session for the requested harness (`pi_core`/`pi_agenta` → ACP
agent `pi`; `claude` → ACP agent `claude`), materializes the workspace (AGENTS.md or
CLAUDE.md, skills, `harnessFiles`), wires tool delivery (Pi: bundled extension + file relay;
Claude: a loopback HTTP MCP server named `agenta-tools`), drives one prompt, and converts
the ACP event stream into `AgentEvent`s + OTel spans via `tracing/otel.ts`. Permission
gating (HITL) runs through a shared plan (`permission-plan.ts` + `responder.ts`), pausing a
turn on `pendingApproval` and resuming cold from replayed message history. Session-owned
runs (a `sessionId` present) additionally heartbeat an alive lock, persist events, and
FUSE-mount a durable cwd (geesefs over an S3 prefix) — all via the Agenta HTTP API
(`sessions/*`, `engines/sandbox_agent/mount.ts`); the runner never touches Redis directly.

**Deployment.** The `runner` compose service exists in all six OSS/EE compose files, is
always on (no profile), `restart: always`, healthchecked, with `SYS_ADMIN` + `/dev/fuse` +
`apparmor:unconfined` for the FUSE mount. The API container `depends_on` it healthy. Helm
has a full runner Deployment (default `replicas: 1`, `/health` probes). Prod runs
`tsx src/server.ts` directly (no compile step, full dev deps in the image), as `USER node`.
No resource limits and no concurrency limits anywhere. `AGENTA_RUNNER_TOKEN` auth is
default OFF; compose overrides the code's loopback default to `0.0.0.0`.

**Doc drift (the short version — full list in the docs sweep below, finding A-19).**
`services/runner/README.md` describes a removed design: it lists `engines/pi.ts` (does not
exist), claims routing "by the request's `backend` field" (no such wire field; the selector
is `harness`, and there is no engine selector at all — `protocol.ts:369`,
`server.ts:166-169`), calls MCP delivery to non-Pi harnesses "disabled" (it is the ACTIVE
Claude delivery channel, restored over loopback HTTP — `tools/mcp-bridge.ts:1-31`), and its
example uses harness id `"pi"` (real ids: `pi_core`/`pi_agenta`/`claude`, `version.ts:15`).
`AGENTS.md` still says "pnpm install # from services/agent". Across
`docs/design/agent-workflows/documentation/` there are 44 stale `services/agent/` paths, a
wrong compose service name (`sandbox-agent` → real name `runner`), and the MCP gate env var
is cited with the wrong name AND the wrong default polarity (docs:
`AGENTA_AGENT_ENABLE_MCP`, off-by-default; code: `AGENTA_AGENT_MCPS_ENABLED`, default
`"true"` — `services/oss/src/agent/tools/resolver.py:27`).

---

## 2. Strengths — keep this

These are genuinely good decisions for a POC-to-prod codebase; the roadmap below should
build on them, not replace them.

- **The golden-fixture wire contract.** Five shared fixtures asserted in-place by BOTH
  languages (`test_wire_contract.py` / `tests/unit/wire-contract.test.ts`), plus a
  compile-time `keyof AgentRunRequest` guard on the TS side and a Pydantic schema mirror
  (`wire_models.py`) on the Python side. Hand-mirroring is risky in general; this is about
  the strongest guard you can build without codegen, and it demonstrably works.
- **"Python decides what, runner runs it" is a real, mostly-held boundary.** All secret,
  tool, connection, and skill resolution happens server-side; the runner receives resolved
  material. The `harnessFiles` mechanism (`protocol.ts:459`, Python renders
  `.claude/settings.json`, runner writes it blind) is exactly the right generic pattern for
  keeping harness knowledge in Python.
- **Fail-loud gates.** The `*_UNSUPPORTED_MESSAGE` family (`run-plan.ts:42-69`,
  `capabilities.ts:51`) refuses runs the runner cannot honestly serve (code tools, stdio
  MCP, tools on non-Pi remote sandboxes, unenforceable network policy) instead of silently
  degrading. The "fail CLOSED for any unknown remote provider" stance
  (`run-plan.ts:275-281`) is the right default for the next sandbox backend.
- **Capability probing exists.** `probeCapabilities` + `assertRequiredCapabilities`
  (`engines/sandbox_agent/capabilities.ts`) is the right (Vercel-AI-SDK-style) mechanism:
  branch on what the harness can do, not on its name. It is half-adopted (see A-8) but the
  scaffolding is there.
- **Testable seams at the entrypoints.** `createAgentServer(run)` / `runCli(raw, {run})`
  and the `SandboxAgentDeps` injection bag let the HTTP/CLI layer and the engine be tested
  with fakes. ~45 unit test files exercise them.
- **Resource-lifecycle discipline.** In-flight sandbox registry + SIGTERM sweep
  (`server.ts:378-399`), the Daytona `ephemeral` + auto-stop leak backstop
  (`provider.ts:41-99`), per-run `finally` teardown, watchdog credential refresh. Someone
  thought hard about leaks.
- **Clear security posture at the credential layer.** Clear-then-apply provider env
  (`daemon.ts:73-162`), SSRF guard on user MCP URLs (`engines/sandbox_agent/mcp.ts:47-95`),
  secrets never in the extension env, non-root prod image, no `env_file` on the compose
  service by design.

---

## 3. Findings

Severity: blocker / high / medium / low. Horizon: **short** = before/at launch,
**medium** = 1–2 months, **long** = structural.

---

### A-1 (HIGH, short→medium) — The run's Agenta credential and API base are smuggled through telemetry config

**Where:** `server.ts:118-134` (`runCredential`, `apiBaseFromRequest`),
`engines/sandbox_agent.ts:121-128` (a second copy of `runCredential`),
`sessions/alive.ts`, `mount.ts` consumers; wire side `protocol.ts:64-72` (`Telemetry`).

**What:** The single most load-bearing credential in the system — the ephemeral Agenta
Secret the runner uses to heartbeat, persist events, sign mounts, create interactions, and
refresh itself — has no wire field. It is extracted from
`request.telemetry.exporters.otlp.headers.authorization`, i.e. from the OTLP *exporter
config*. The Agenta API base is likewise recovered by string-slicing the OTLP endpoint on
the marker `"/otlp/"` (`server.ts:127-134`). Classified by semantic role, a
**credential** and a **routing** value are riding inside operator **telemetry config**.

**Why it matters:** (a) Turning off or redirecting tracing silently breaks sessions,
mounts, and HITL interactions — completely unrelated features. (b) The extraction logic is
duplicated in two files and consumed by five subsystems, so any change to telemetry shape
is a cross-cutting hazard. (c) It makes the contract unreadable: a reviewer of
`protocol.ts` cannot see that the runner authenticates back to Agenta at all. (d) The
comment "it rides the telemetry exporter headers (where the run's Agenta secret already
lives, kept verbatim)" documents the accident rather than fixing it.

**Recommendation:** Add a first-class wire block, e.g.
`platform?: { endpoint: string; authorization: string }` (routing + credential together,
owned by the service, per-call lifecycle). Runner: one `platformAuth(request)` accessor in
a single module; keep the telemetry fallback for one release (mirror of the `/run`→`/stream`
alias policy). Python: emit both for one release. Golden fixtures updated deliberately.
Short horizon for centralizing the extraction into one function; medium for the wire field.

---

### A-2 (HIGH, short) — `process.env` is mutated per-request; module-level caches keyed on per-run credentials

**Where:** `server.ts:227-232` (`process.env.AGENTA_API_URL = requestApiBase` inside the
request handler), `tracing/otel.ts:68-91` (`traceTargets`, `exporterCache` keyed by
`endpoint + authorization`).

**What:** A request-derived value is written into process-global env at request time
(guarded by "only if unset", but that means the FIRST request wins forever, and it races
with concurrent first requests). Separately, `exporterCache` creates and caches one
`OTLPTraceExporter` per distinct `endpoint\nauthorization` pair; the authorization on the
live path is a ~15-minute **ephemeral** Secret, so a busy sidecar accumulates one exporter
(with its own HTTP machinery) per run credential, unbounded. `traceTargets` is cleaned on
flush (`otel.ts:141`); `exporterCache` is never evicted.

**Why:** These are the two pieces of state that would poison a long-lived multi-tenant
sidecar: cross-request contamination via env, and slow memory growth via the cache. Both
are invisible in tests (one run at a time).

**Recommendation:** Delete the env write — thread the API base through the same
first-class `platform` field as A-1 (or a per-run context object). Key `exporterCache` by
endpoint only and pass the Authorization header per export, or add an LRU with eviction +
`shutdown()`. Short horizon; small diffs.

---

### A-3 (HIGH, medium) — `runSandboxAgent` is a 650-line God function; the engine's phases have no seams

**Where:** `engines/sandbox_agent.ts:317-973`.

**What:** One function owns: mount signing and the durable-cwd derivation, run-plan
building, daemon env assembly, Claude-specific env quirks, Pi extension env, sandbox boot,
Daytona asset upload, workspace prep with an ENOTCONN retry state machine, capability
probing and gating, MCP channel construction with a deferred-relay indirection, session
creation, model resolution, otel wiring, HITL responder + pause-controller + latch +
interaction-recording wiring, the tool relay, the prompt race against the pause signal,
usage resolution, swallowed-Pi-error recovery, and an 8-step `finally`. The
`SandboxAgentDeps` bag has ~25 injectable members (`sandbox_agent.ts:247-269`) — a symptom:
the only way to test any phase is to inject around all the others.

**Why:** Every reviewer of every future change must re-read the whole function to know
what ordering invariants they are breaking (the code comments themselves track at least
five: sign-before-plan, mount-before-workspace, relay-after-responder,
usage-before-finish, abort-before-teardown). This is the file where the next three
production bugs will live.

**Recommendation:** Extract the phases along the lifecycle the comments already name:
`prepare` (plan + mounts + workspace) → `connect` (sandbox + session + capabilities) →
`wire` (tools/MCP/HITL/tracing) → `drive` (prompt/pause/usage) → `settle` (result/error) →
`dispose` (the finally). Each phase takes/returns an explicit `RunState`; `finally` becomes
a stack of registered disposers (push a cleanup when you acquire a resource — this also
kills the "did the finally cover the new resource?" class of leak). No behavior change;
mechanical, test-preserving. Medium horizon, but start with `dispose` (the disposer stack)
short-term since it is the highest-risk part.

---

### A-4 (HIGH, medium) — Harness knowledge is smeared across the runner despite the "dumb writer" doctrine

**Where (the smear):**
- `engines/sandbox_agent.ts:189-245` `applyClaudeConnectionEnv` — Claude env vars,
  Bedrock/Vertex flags, the `ENABLE_TOOL_SEARCH` workaround;
- `engines/sandbox_agent/workspace.ts:49-54` — `CLAUDE.md` vs `AGENTS.md`,
  `.${acpAgent}/skills` skill root, immediately below a doc comment that says harness
  files are "written blind — no harness knowledge on the runner";
- `run-plan.ts:249-265` — the `pi_core|pi_agenta → pi` mapping;
  `run-plan.ts:284-285` — `legacyHarnessApiKeyVar` by harness name;
- `capabilities.ts:99-116` — static capability fallback keyed on `harness === "pi"`;
- `sandbox_agent.ts:771` — the permission-gate locus decision `enforce: plan.isPi`
  (the comment itself says "if more harness families arrive, move this");
- `pi-error.ts` — reads Pi's private session transcript format off disk;
- `pi-assets.ts` — Pi agent-dir layout, extension install, auth.json upload;
- `tracing/otel.ts` `emitSpans: !plan.isPi || plan.isDaytona` (`sandbox_agent.ts:696`);
- usage: Pi writes a file, others report on PromptResponse (`usage.ts`).

`grep -c isPi` in src = 34; `grep -c isDaytona` = 35.

**What/why:** The stated architecture ("the Python harness adapter renders harness
specifics; the runner stays a dumb writer", `protocol.ts:450-458`) is the right target and
`harnessFiles` proves it works — but only Claude's settings.json made the jump. Everything
else is `if (isPi)` / `if (acpAgent === "claude")` scattered over nine files. Adding a
harness (codex/opencode) today touches, at minimum: `version.ts` HARNESSES, `run-plan.ts`
mapping + legacy key var, `capabilities.ts` static table, `workspace.ts` instructions file
+ skill root, `sandbox_agent.ts` env quirks + gate locus + emitSpans, usage resolution,
plus Python `capabilities.py`, `harnesses.py`, and possibly a settings renderer — **10+
touch points across two languages** with no checklist.

**Recommendation:** Introduce ONE table: a `HarnessProfile` record per harness id
(`acpAgent`, `instructionsFileName`, `projectSkillRoot`, `toolDelivery: "extension" |
"mcp"`, `permissionGateLocus: "relay" | "acp"`, `usageSource: "file" | "prompt-response"`,
`selfInstruments: boolean`, `applyConnectionEnv(env, request)`, `legacyApiKeyVar`) in one
module, consumed everywhere the branches live today. This is the Lars-Grammel provider
pattern: the harness becomes a value, not a condition. Do it incrementally — each extracted
branch is its own small PR. Medium horizon; the payoff is that "add codex" becomes one
profile object + one Python adapter.

---

### A-5 (HIGH, medium) — The sandbox backend is a boolean, not a port

**Where:** `plan.isDaytona` branches in `run-plan.ts` (cwd + relay base paths, hardcoded
`/home/sandbox/agenta/...` at `sandbox_agent.ts:344-351` and `run-plan.ts:388-390`),
`workspace.ts:56-93` (two full copies of workspace prep: sandbox-FS API vs node:fs),
`mcp.ts:244-263` (loopback reachability), `tools/relay.ts:165-203`
(`localRelayHost`/`sandboxRelayHost`), `daytona.ts`, `mount.ts` (local geesefs vs remote
tunnel mount), `provider.ts:111-130`, `usage.ts`, `pi-error.ts` ("never on Daytona").
Everything takes `sandbox: any` (64 `: any` occurrences in src, most of them this handle).

**What/why:** The second variability axis (where the daemon runs) is expressed as
`isDaytona: boolean` plus an `isRemoteSandbox` fallback. A k8s-pod or Firecracker/E2B
backend cannot be added by implementing an interface; it requires re-editing every branch.
The good news: the code already fails closed for unknown providers (`run-plan.ts:275-281`)
and the file-relay abstraction (`RelayHost`) shows the team knows how to cut this seam.

**Recommendation:** Define a `SandboxBackend` port that owns what the booleans currently
select: `{ id, isRemote, cwdRoot(), relayRoot(), fs: {mkdir, writeFile, readFile, upload},
exec(), mountDurable(), buildProvider(), capabilities: {runnerLoopbackReachable} }`, with
`LocalBackend` and `DaytonaBackend` implementations wrapping today's code, and type the
sandbox-agent handle once instead of `any`. `workspace.ts` collapses to one code path over
`backend.fs`. Medium/long horizon; do the typed handle (kill `sandbox: any`) short-term.

---

### A-6 (HIGH, short) — No admission control: unbounded concurrent runs on a process with no resource limits

**Where:** `server.ts:294-357` (no in-flight cap, no body-size limit, no per-run timeout),
compose files (no `mem_limit`/`cpus` anywhere), Helm (`resources` optional, default none).

**What:** Every `POST /run` immediately starts a run. A local-sandbox run spawns a
`sandbox-agent` daemon child + a harness process + possibly a FUSE mount **on the sidecar
host**; there is no semaphore, no queue, no 429/503, and no request-body cap
(`readBody` buffers the whole body — with `messages` carrying full conversation history,
a large replay is fully materialized in memory per request). There is also no server-side
run deadline: the Python client times out at 180s, but a client that disconnects leaves a
session-owned run running by design — with nothing bounding how many do so.

**Why:** This is the most likely production failure mode in week one: a burst of playground
runs (or one retry loop) forks N daemons and OOMs the container; `restart: always` then
kills every in-flight run on the box, including well-behaved ones.

**Recommendation (short):** (1) a max-inflight semaphore (env-tunable, e.g. 8 local / 32
daytona) returning 503 + `Retry-After` when saturated; (2) a body-size cap on `readBody`;
(3) a server-side max run duration that aborts the run's signal; (4) compose/Helm memory
limits sized to the semaphore. Expose in-flight count on `/health` for the sweeper and for
horizontal-scaling decisions later.

---

### A-7 (HIGH, short) — The versioning story exists on the server and has no client: skew is undetected

**Where:** `version.ts:1-35` (`PROTOCOL_VERSION = 1`, `/health` returns
`{runner, protocol, engines, harnesses}` "so a client can detect an incompatible runner
before the first run"); `sdks/python/agenta/sdk/agents/utils/ts_runner.py` — **no** call to
`/health`, no protocol check anywhere in the SDK (verified by grep); the SDK still posts the
back-compat alias `/run` while the productized route is `/stream` (`server.ts:314-318`,
"kept for one release"); the CLI transport has no version surface at all; the runner never
validates the request beyond `JSON.parse` (`server.ts:326` — a cast, not a check).

**What happens on skew in prod today:** an old runner silently ignores unknown fields (new
SDK feature no-ops — the F-032 silent-drop class this codebase has repeatedly fought); a new
runner receiving an old request relies on per-field back-compat heuristics
(`credentialMode` absent → `hasApiKey` guess, `run-plan.ts:475-481`). Compose pins api+
runner together (`depends_on`), so compose skew is bounded to deploy windows — but Helm
tags the runner image independently (`agentRunner.image.tag`), and the "one release" alias
promise has no mechanism enforcing it.

**Recommendation (short, cheap):** In `SandboxAgentBackend`/`ts_runner`, probe `/health`
once per process (cached), warn on `protocol` mismatch, fail on a major the SDK does not
support; switch the SDK to `/stream` at the same time. Medium: echo
`protocol` in every result envelope so the CLI path is covered too, and add a
`protocolVersion` field to the request that the runner logs when it differs. Long: see A-9.

---

### A-8 (MEDIUM, medium) — Capability-based branching is half-adopted; the other half re-branches on names

**Where:** `probeCapabilities` (good) vs: static fallback by `harness === "pi"`
(`capabilities.ts:99-116`); relay-vs-ACP permission gate chosen by `plan.isPi`
(`sandbox_agent.ts:769-771`); tool delivery chosen by `isPi` (extension) before the
`mcpTools` capability is even consulted (`mcp.ts:231`); `emitSpans` by `!plan.isPi`.

**What/why:** The README claims "branches on capabilities, not the harness name"; in
reality the *tool-count gate* does, and the delivery/gating/tracing decisions do not. These
name-keyed decisions are exactly the ones a new harness trips over. They are also
runner-local capabilities (does this harness self-instrument? does it load our extension?)
that sandbox-agent's probe can never answer — which is fine: they belong in the
`HarnessProfile` of A-4, next to the probed capabilities, not scattered.

**Recommendation:** Fold the name-keyed decisions into the A-4 profile as declared
capabilities (`selfInstruments`, `loadsAgentaExtension`, `permissionGateLocus`), keeping the
runtime probe for what the daemon genuinely knows. Medium horizon; pairs with A-4.

---

### A-9 (MEDIUM, long) — The hand-mirrored contract is at its complexity ceiling; move to a schema-first contract

**Where:** `protocol.ts` (556 lines, types only, erased at runtime) mirrored by
`utils/wire.py` (192 lines, hand-built dict) **and** `wire_models.py` (509 lines, a second
Pydantic mirror that exists only to emit JSON Schema) **and** the golden fixtures **and**
two contract tests. A field change touches 3 definitions + goldens + 2 tests, per
`AGENTS.md`'s own instructions. Cross-language constants live outside the guard entirely:
`INTERNAL_TOOL_MCP_SERVER = "agenta-tools"` in `claude_settings.py:52-60` must match four
TS files with only a comment; permission-mode vocab is duplicated in
`permission-plan.ts:67-73` and the SDK.

**What/why:** The current guard is genuinely strong (see Strengths) and is NOT the launch
risk. But it is O(n) human discipline per field, it validates nothing at runtime (the
runner trusts `JSON.parse` casts; `wire_models.py:20-25` says explicitly "NOT a runtime
guard"), and the third mirror (`wire_models.py`) exists precisely because the hand-built
dict cannot express its own schema. That is the signal the approach has topped out.

**Recommendation (long, incremental):** Make ONE side authoritative and derive the other.
Pragmatic path given the team: author the contract as **zod schemas in the runner**
(`protocol.ts` types become `z.infer` — no consumer changes), then (1) the runner gains
runtime validation at the boundary for free (fail-loud on malformed requests, per the
codebase's own doctrine); (2) emit JSON Schema from zod in CI and assert
`wire_models.py`'s schema equals it (deleting drift by construction, then eventually
deleting `wire_models.py` in favor of datamodel-code-generated Pydantic); (3) keep the
golden fixtures as the semantic layer on top. Also add a tiny golden that pins the shared
constants (`agenta-tools`, relay suffixes, permission vocab).

---

### A-10 (MEDIUM, short) — Wire fields misclassified by role: Pi-only knobs and a policy default living in generic positions

**Where:** `protocol.ts:378-389` (`systemPrompt` / `appendSystemPrompt`, documented "Pi
only" and silently ignored for Claude — `run-plan.ts:403-408`); `protocol.ts:428`
(`tools?: string[]` documented "Built-in tools to enable" but actually interpreted ONLY as
Pi builtin grants — `normalizePiBuiltinGrants`, `run-plan.ts:169-182`, silently drops
non-Pi names); `permission-plan.ts:111` (the effective **default** permission mode
`allow_reads` is decided in the RUNNER when the request omits it — policy ownership
belongs to the SDK/service, which should always send an explicit resolved default);
`protocol.ts:484-488` (`projectId` documented "so the runner can include it in heartbeat
and record-ingest calls" while `sessions/alive.ts:51-53` documents the opposite — "no
project_id rides the request"; nothing reads `request.projectId` in src).

**What/why:** By the interface-design rule (classify fields by what they ARE), these are
harness-scoped config and policy defaults sitting in generic top-level positions. Each one
is a silent-drop trap for the next harness and an ownership ambiguity between Python and
TS. `projectId` is a dead field carrying a false doc.

**Recommendation (short, contract-compatible):** Fix the doc comments now (mark `tools` as
Pi-builtin grants; delete or honestly document `projectId`); make the service always send
`permissions.default` explicitly so the runner's fallback becomes dead code. Medium: fold
Pi-only knobs into the `harnessFiles`/harness-options pattern that Claude's settings
already use — one `harnessOptions?: Record<string, unknown>` envelope rendered by the
Python harness adapter, so the top level stays harness-neutral.

---

### A-11 (MEDIUM, medium) — `tracing/otel.ts` is a dual-purpose God module: event normalization lives inside the tracer

**Where:** `tracing/otel.ts` (1315 lines — the largest file in the runner). It contains:
the OTLP export machinery (processor, batching-by-trace, exporter cache), `createAgentaOtel`
(the Pi-extension tracer, runs INSIDE the sandbox), `createSandboxAgentOtel` (the engine's
ACP-update → `AgentEvent` state machine — `handleUpdate`, `emitEvent`, `events()`,
`output()`, `usage()`, `finish()`), and text utilities (`stripStartupBanner` etc.).

**What/why:** The engine cannot produce its *result* (`output`, `messages`, `events`)
without instantiating the tracer — the run's event log and the span exporter are one
object. That inverts the dependency: tracing should observe the event stream, not own it.
It also couples the two runtime environments (see A-12) into one file, and it makes the
tracing reviewer's (E's) surface include protocol semantics.

**Recommendation:** Split into `run-events.ts` (ACP update → AgentEvent normalization +
run-state accumulation; pure, no OTel imports) and `tracing/` (span building + export,
subscribing to the event stream). `createSandboxAgentOtel` becomes a thin composition of
the two. Medium horizon; mechanical but large — do it before the streaming/event surface
grows further.

---

### A-12 (MEDIUM, medium) — The sidecar/extension runtime boundary is invisible in the source tree

**Where:** `extensions/agenta.ts` imports `tools/dispatch.ts`, `tools/callback.ts`,
`tools/spec-schema.ts`, `tracing/otel.ts` — and is then esbuild-bundled into
`dist/extensions/agenta.js`, which executes in a DIFFERENT process and often a DIFFERENT
machine (inside Pi, possibly in a Daytona sandbox).

**What/why:** Nothing in the tree marks which modules are "safe to run inside the
sandbox". An innocent edit to `dispatch.ts` (e.g. importing `apiBase.ts` or a
sessions module) would silently ship sidecar-only assumptions — or worse, secrets-handling
code — into the sandbox bundle, and take effect only after `build:extension` (the
stale-bundle failure mode already bitten once: custom tools silently undelivered on a stale
extension, QA finding). The duplication of `PI_BUILTIN_TOOL_NAMES` between
`extensions/agenta.ts:58-66` and `permission-plan.ts:40-48` exists precisely because the
boundary is unclear.

**Recommendation:** Create a `src/shared/` (or `src/ext-safe/`) layer containing exactly
what the extension may import (protocol types, spec-schema, the relay file protocol
constants, the extension-side tracer), enforce it with an eslint boundary rule or a tiny
import-graph test, and make the extension bundle build part of `pnpm test`/CI so a stale
`dist/` cannot ship. Medium horizon.

---

### A-13 (MEDIUM, short) — Cyclic import between `tools/` and `engines/`

**Where:** `tools/mcp-bridge.ts:24` imports `type { McpServerHttp } from
"../engines/sandbox_agent/mcp.ts"`; `engines/sandbox_agent/mcp.ts:6-10` imports
`buildToolMcpServers`, `USER_MCP_UNSUPPORTED_MESSAGE`, `McpServerStdio` from
`tools/mcp-bridge.ts`. `run-plan.ts` (engine) also imports refusal constants from
`tools/mcp-bridge.ts` and `tools/code.ts`.

**What/why:** Runtime-safe today (one direction is type-only), but the layering statement
"engines depend on tools, tools depend on protocol" is broken: the tools layer names an
engine-internal type. The refusal-message constants form a shared vocabulary that has no
home, so they get imported from wherever they happen to live.

**Recommendation (short, one-hour fix):** Move `McpServerHttp`/`McpServerStdio` (they are
ACP wire shapes, not engine logic) and the `*_UNSUPPORTED_MESSAGE` constants into a
leaf module (e.g. `src/acp-types.ts` / `src/messages.ts` or into `protocol.ts`-adjacent
shared code). After that, enforce direction: `entry → engines → tools → core → protocol`.

---

### A-14 (MEDIUM, medium) — The service re-implements the SDK's orchestration instead of using its seam

**Where (Python):** `handler.py:86-179` defines `AgentComposition` +
`make_agent_handler(composition)` — an injectable seam built exactly so the service can
plug `select_backend` / `resolve_session_connection` / tracing. The service does not use
it: `app.py:207-278` re-implements the `_agent` body (~70 lines), with
`_agent_model_ref` copied verbatim (`app.py:77-89` == `handler.py:102-107`), plus a second
independent read of `AGENTA_RUNNER_TIMEOUT_SECONDS` (`ts_runner.py:16` vs
`sandbox_agent.py:137`) and duplicated URL-selection logic.

**What/why:** This is the main Python-side layering defect: two orchestrations that must
be kept in sync by hand, one of which is the deployed one. They already differ slightly.
Every new run-level feature (streaming changes, new wire field, capability check) must be
added twice or silently diverges.

**Recommendation:** Make `app.py` construct an `AgentComposition` and call
`make_agent_handler` — delete the duplicated body. If the handler seam is missing a hook
the service needs, extend the seam rather than forking the body. Medium horizon; this is a
one-file refactor with existing tests on both sides.

---

### A-15 (MEDIUM, medium) — `/kill` is a process-wide hammer; replica-level teardown vs session-level intent

**Where:** `server.ts:303-312` — `POST /kill` calls `destroyInFlightSandboxes()`, which
tears down EVERY in-flight sandbox on the replica; the comment says it exists "so the
orphan sweeper can force a process-wide teardown out-of-band".

**What/why:** With one concurrent run this is fine. With A-6's semaphore admitting 8
concurrent runs, an orphan sweep targeting one leaked session destroys seven healthy runs.
The granularity of the endpoint does not match the granularity of its caller's intent.

**Recommendation:** Accept an optional `sessionId`/`turnId` body and tear down only the
matching in-flight entry (the `inFlightSandboxes` registry needs to become a
Map keyed by run/session); keep the no-body process-wide behavior for the true
shutdown/last-resort case. Medium horizon, small change, do it together with A-6.

---

### A-16 (MEDIUM, medium) — Horizontal scaling is designed-for but unproven and undocumented at the ops layer

**Where:** `sessions/alive.ts:26-33` (`replica_id`, owner-affinity keys — genuine
multi-replica design), Helm `replicas` default 1, compose no scaling, `/kill` per-replica
(A-15), local-sandbox runs pinned to the replica's own filesystem/FUSE mounts, in-process
`InMemorySessionPersistDriver` per run.

**What/why:** The coordination plane (alive lock via API, replica affinity) is built for
N>1, but nothing routes a *resume* or a *steer* to the owning replica at the HTTP layer —
the runner is called through one service URL (`http://runner:8765`), which load-balances
blind under compose/k8s. Cross-turn state is deliberately cold (history replays), so plain
`/run` scale-out mostly works — but session-owned features (durable cwd mounts on the
local backend, mid-turn `/kill`, interaction resume racing) have replica-affinity
assumptions that hold only at replicas=1.

**Recommendation:** Write the scaling contract down (one page in the runner README): what
is safe at N replicas today (stateless cold runs) and what is not (local durable-cwd
sessions). Short: keep Helm default 1 and add an explicit warning on `agentRunner.replicas`.
Medium: either route by `owner:session:<id>` affinity at the service (it already knows the
replica id from heartbeats) or declare Daytona-only for multi-replica session runs.

---

### A-17 (MEDIUM, medium) — Tool executor kinds dispatch in three places; adding a kind is a shotgun change

**Where:** `tools/dispatch.ts:221-268` (`runResolvedTool`, the declared "single dispatch
home"), but `tools/relay.ts:205-265` (`executeRelayedTool`) re-implements kind branching
for the relay path, and `tools/tool-mcp-http.ts` carries its own client-tool pause
branch; `run-plan.ts:161-166,323-356` gates kinds a fourth time (`hasCodeTool`, client
tools in the remote gate).

**What/why:** `dispatch.ts`'s header says the point of the module is that a kind change is
"a one-line edit, not several" — that promise no longer holds. Adding a `browser` or
`workflow` executor kind touches dispatch, relay, the MCP HTTP server, the run-plan gates,
`spec-schema`, the SDK resolver, and the wire docs.

**Recommendation:** An executor registry: `Record<kind, {execute, gate, advertisable}>`
consumed by all three delivery paths, with the run-plan gates asking the registry
(`registry[kind].supported(plan)`) instead of hand-listing kinds. Medium horizon; pairs
naturally with A-4/A-5.

---

### A-18 (LOW, medium) — Observability is stderr prose; no metrics, no structured logs, no run correlation

**Where:** every subsystem logs via `process.stderr.write("[tag] ...")` with per-module
tags (`[sandbox-agent]`, `[sessions]`, `[HITL]`, `[sessions/alive]`); no request/run id is
attached to log lines; there is no `/metrics`, no counter for runs started/failed/paused,
queue depth, sandbox boot latency, relay poll latency.

**Why:** Next week, "the playground hangs" gets debugged by grepping interleaved stderr of
concurrent runs with no correlation key. The information exists (turnId, sessionId) but is
inconsistently included.

**Recommendation:** Short: one `log(runId, msg)` helper threaded through deps (the `Log`
type already exists everywhere — change its signature once) so every line carries the run
id. Medium: counters on `/health` (in-flight, total, failed, paused) — the sweep/ops
tooling can poll it; full metrics endpoint only when there is a consumer.

---

### A-19 (HIGH severity for a docs item because it actively misleads, short) — README/AGENTS.md and the design docs describe a removed architecture

**Where/what (verified):**
- `services/runner/README.md:22` — routing "by the request's `backend` field": no such
  field (`protocol.ts:369`; grep confirms `backend` appears only in prose).
- `README.md:30-32,46-54` — `engines/pi.ts` listed as a live engine: file does not exist;
  harness values given as `pi`/`claude`/`agenta` vs real `pi_core`/`claude`/`pi_agenta`
  (`version.ts:15`).
- `README.md:39-40,91-96` — MCP delivery described as disabled; `tools/mcp-bridge.ts` is
  the ACTIVE Claude delivery channel over loopback HTTP (the stdio `mcp-server.ts` is the
  removed one). The README inverts which module is dead.
- `README.md:125` — the quickstart example sends `{"backend":"sandbox-agent","harness":"pi"}`
  — both fields wrong; a new contributor's first command fails.
- `AGENTS.md:21` — "pnpm install # from services/agent" (stale path).
- `docs/design/agent-workflows/documentation/`: 44 stale `services/agent/` paths across 8
  docs; `architecture.md:48,59` compose service `sandbox-agent` → real `runner`; MCP gate
  cited as `AGENTA_AGENT_ENABLE_MCP` off-by-default in 5 docs vs real
  `AGENTA_AGENT_MCPS_ENABLED` default `"true"` (`tools/resolver.py:27`) — name AND
  polarity wrong; `tools.md:195` describes the stdio bridge that was replaced by
  `tool-mcp-http.ts`; stale line cites (`sandbox_agent.ts:150`→`:501`, `app.py:49`→`:192`).
- Wire-doc contradiction inside the code itself: `protocol.ts:484-488` (`projectId` rides
  heartbeats) vs `sessions/alive.ts:51-53` (no project_id rides the request) — see A-10.

**Recommendation (short, before launch):** Rewrite `README.md` from
`architecture.md`'s accurate "what the deployed service actually runs" section; sweep
`services/agent/` → `services/runner/`; fix the MCP gate name/polarity everywhere; fix the
two AGENTS.md stale lines. This is half a day and prevents every new contributor (and
every agent run against this repo) from being trained on a false architecture.

---

### A-20 (LOW, long) — Prod runs TypeScript through `tsx` with full dev dependencies in the image

**Where:** `docker/Dockerfile:48-75` — `pnpm install --frozen-lockfile` (full, because
`tsx` and `esbuild` are devDependencies), `CMD ["node_modules/.bin/tsx", "src/server.ts"]`.

**What/why:** No compile step means no `tsc` gate at image build (a type error ships and
throws at first request-touch), a larger image/attack surface (vitest et al. in prod), and
slower cold start. Not a launch blocker — `tsc --noEmit` runs in CI — but it is the
"libraries first, binary last" step not yet taken.

**Recommendation (long):** Add a real build (`tsc` or esbuild-bundle `server.ts` the same
way the extension is bundled), `pnpm install --prod` in the final stage, and run
`node dist/server.js`. Do it when the package split (A-21) happens anyway.

---

### A-21 (structural summary, long) — Target structure and migration path

The current flat layout was right for the POC. Judged by the stated reference points —
small composable modules with explicit boundary types and provider/registry patterns
(Grammel), and layered packages with strict dependency direction where the entrypoint is
the last, thinnest layer (Hashimoto) — the gaps are: no enforced layering (A-13), two God
modules (A-3, A-11), variability expressed as booleans/branches instead of
providers/profiles (A-4, A-5, A-8, A-17), and an invisible second runtime target (A-12).

**Target tree (same package, no big bang — directories first, packages only if ever needed):**

```
src/
  protocol/        wire contract (zod source → types), shared vocab constants   [leaf]
  core/            permission-plan, responder, run-events (from otel.ts), errors
  harness/         HarnessProfile table + per-harness profile modules (pi, claude)
  sandbox/         SandboxBackend port + local/, daytona/ implementations
  tools/           executor registry + delivery channels (relay, mcp-http, callback)
  tracing/         span building + OTLP export only (subscribes to core/run-events)
  sessions/        alive / persist / interactions / mount (platform-API client in one place)
  engine/          the one orchestrator, now phase-structured (A-3), consuming the ports
  ext/             the Pi extension + its import-allowlisted shared surface (A-12)
  entry/           server.ts, cli.ts  (thin; last layer)
```

Dependency rule (enforced by lint or an import test): left/lower may never import
right/upper; `protocol/` and `core/` import nothing internal; `entry/` imports anything.

**Migration order (each step independently shippable):**
1. **Now (pre-launch):** A-6 admission control, A-2 env/cache fixes, A-1 centralize the
   credential accessor, A-7 SDK `/health` probe, A-19 doc rewrite, A-13 break the cycle.
2. **Month 1:** A-3 phase extraction + disposer stack; A-11 split run-events out of
   otel.ts; A-14 service uses the handler seam; A-15 targeted `/kill`.
3. **Month 2:** A-4 HarnessProfile + A-8 capability fold-in; A-5 SandboxBackend port +
   typed handle; A-17 executor registry; A-12 ext boundary + CI bundle build.
4. **Later:** A-9 zod-first contract with generated Python; A-20 real build; revisit
   multi-replica routing (A-16) when scale demands it.

---

## 4. Top-10 priorities

1. **A-6** Admission control + body cap + run deadline + memory limits (short) — the
   week-one production risk.
2. **A-19** Rewrite README/AGENTS.md + docs sweep (short) — actively misleading today,
   half a day to fix.
3. **A-7** SDK probes `/health`, checks `protocol`, moves to `/stream` (short) — the skew
   guard exists server-side; give it its client.
4. **A-1** First-class `platform {endpoint, authorization}` wire block; single accessor
   now (short→medium) — stop smuggling the system's most important credential through
   telemetry config.
5. **A-2** Delete the request-time `process.env` write; fix the exporter cache keyed on
   ephemeral credentials (short).
6. **A-3** Phase-structure `runSandboxAgent`; disposer stack for the `finally` (medium) —
   the file where the next bugs live.
7. **A-4 + A-8** `HarnessProfile` table; fold name-keyed branches into declared
   capabilities (medium) — makes "add codex/opencode" a one-object change.
8. **A-14** Service adopts the SDK's `AgentComposition` seam; delete the duplicated
   orchestration (medium).
9. **A-11** Split event normalization (`run-events`) out of `tracing/otel.ts` (medium) —
   unblocks the streaming/event roadmap and shrinks the tracing surface.
10. **A-5** `SandboxBackend` port + typed sandbox handle (medium→long) — the prerequisite
    for k8s/Firecracker/E2B backends, and it deletes 35 `isDaytona` branches.

**Counts:** 0 blocker · 8 high (A-1, A-2, A-3, A-4, A-5, A-6, A-7, A-19) · 10 medium
(A-8…A-17 excl. A-9's long tail) · 3 low (A-18, A-20, plus doc-comment fixes inside A-10).
