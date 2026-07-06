# Runner review — tests & QA (reviewer F)

Scope: `services/runner/tests/**`, `vitest.config.ts`, `package.json` scripts, CI wiring, the
wire-contract golden setup, and how much of the manual QA matrix could be automated. Does not
review `src/` logic itself (other reviewers cover that) — only what is and isn't tested, and
how well.

## Test run status (2026-07-05)

Ran everything locally on Node v24.16.0 (matches the pinned Node 24 requirement).

| Command | Result |
| --- | --- |
| `pnpm run typecheck` | **PASS**, clean, no errors |
| `pnpm run test:unit` | **PASS** — 44 files, 525 tests, 4.4s |
| `pnpm run test:integration` | **PASS** — 1 file, 8 tests, 0.6s (Redis-dependent assertions self-skip when Redis is absent, which it was) |
| `pnpm run test:acceptance` | **PASS** — 1 file, 16 tests, 0.65s |
| `pnpm run test:coverage` | **RAN** — v8 coverage, see table below |

All three layers are green. CI (`.github/workflows/12-check-unit-tests.yml`, jobs
`run-runner-tests` / `run-runner-integration-tests` / `run-runner-acceptance-tests`) runs
typecheck + all three layers as separate jobs with JUnit publishing, gated only by
"not a draft PR" — **this suite is wired into CI**, not just a local convention. No coverage
job exists in CI; `test:coverage` is local/manual only, with no thresholds configured
anywhere (`vitest.config.ts` has no `coverage` block).

## Coverage map

Per-file v8 statement coverage from the actual run, cross-referenced against which test
file(s) exercise each module (found by tracing both static and dynamic `import()` in every
`tests/unit/*.test.ts`). "Behavior/detail" is my read of whether the test asserts observable
behavior (status codes, wire shapes, side effects) vs. internal call order/implementation
detail.

| src module | test file(s) | stmt cov | behavior/detail | note |
| --- | --- | --- | --- | --- |
| `apiBase.ts` | *(no dedicated test; exercised transitively via sessions/*)* | 100%* | detail-only | *not asserted directly — the internal/public precedence and trailing-slash trim have no dedicated test, just incidental execution with unset env vars |
| `cli.ts` | `cli.test.ts` | 57.1% | behavior | seam (`runCli(raw, stream, io)`) used correctly; uncovered = `main()`/stdin/`isEntrypoint` glue, inert by design during tests |
| `entry.ts` | *(none directly; exercised via cli/server module load)* | 60% | — | trivial, low-risk |
| `permission-plan.ts` | `permission-plan.test.ts`, `permission-parity.test.ts`, `tool-relay-permission*.test.ts` | 91.75% | behavior | strong; cross-language golden pinned too |
| `protocol.ts` | `wire-contract.test.ts` + almost every other file (types) | 75% | behavior | the few runtime helpers (`resolvePromptText`, `messageText`, `resolveRunSessionId`) are well exercised |
| `responder.ts` | `responder.test.ts`, `tool-relay-permission*.test.ts` | 94.7% | behavior | strong |
| `server.ts` | `server.test.ts`, `server-smoke.test.ts`, `server-contract.test.ts` | 64.4% | behavior | HTTP surface strongly covered; shutdown-handler tests are a standout (see Strengths); uncovered lines are mostly less-common branches |
| `engines/sandbox_agent.ts` (orchestration) | `sandbox-agent-orchestration.test.ts`, `continuation.test.ts`, `mcp-servers.test.ts` | 81.2% | behavior | `runSandboxAgent` driven directly with an injected fake harness (25 tests); `destroyInFlightSandboxes` NOT exercised at all — its tracking `Set` is module-private, no test seam |
| `engines/skills.ts` | `skills.test.ts` | 94.1% | behavior | strong |
| `engines/sandbox_agent/acp-fetch.ts` | `sandbox-agent-acp-fetch.test.ts` | 90% | behavior | good |
| `engines/sandbox_agent/acp-interactions.ts` | `sandbox-agent-acp-interactions.test.ts` | 89.5% | behavior | good, incl. a concurrent-pending-gates test |
| `engines/sandbox_agent/capabilities.ts` | `sandbox-agent-capabilities.test.ts` | 100% | behavior | strong |
| `engines/sandbox_agent/client-tools.ts` | `client-tools.test.ts` | 96.1% | behavior | strong |
| `engines/sandbox_agent/daemon.ts` | `sandbox-agent-daemon.test.ts` | 44.7% | **split** | `buildDaemonEnv` (security-critical clear-then-apply) is thoroughly tested; `resolveDaemonBinary` (env/package/pnpm-store fallback chain) is **0% covered** |
| `engines/sandbox_agent/daytona.ts` | `sandbox-agent-daytona.test.ts` | 71.2% | behavior | moderate; only 3 tests for a provider integration |
| `engines/sandbox_agent/errors.ts` | `sandbox-agent-errors.test.ts` | 100% | behavior | strong |
| `engines/sandbox_agent/mcp.ts` | `mcp-servers.test.ts`, `session-mcp-layering.test.ts` | 96.9% | behavior | strong |
| `engines/sandbox_agent/model.ts` | `sandbox-agent-model.test.ts` | 61.1% | behavior | moderate, only 7 tests |
| `engines/sandbox_agent/mount.ts` | `sandbox-agent-mount.test.ts` | 71.0% | behavior | moderate |
| `engines/sandbox_agent/pause.ts` | `sandbox-agent-orchestration.test.ts` (indirect) | 87.5% | behavior | no dedicated file, fine given the size |
| `engines/sandbox_agent/pi-assets.ts` | `sandbox-agent-pi-assets.test.ts` | 68.9% | behavior | moderate |
| `engines/sandbox_agent/pi-error.ts` | `sandbox-agent-pi-error.test.ts` | 84.3% | behavior | good |
| `engines/sandbox_agent/provider.ts` | `sandbox-agent-provider.test.ts` | 77.3% | behavior | moderate |
| `engines/sandbox_agent/run-plan.ts` | `sandbox-agent-run-plan.test.ts` (47 tests) | 93.1% | behavior | strong, the biggest single test file by test count |
| `engines/sandbox_agent/transcript.ts` | `continuation.test.ts` | 64.6% | behavior | pure functions (`priorMessages`/`messageTranscript`/`buildTurnText`), light coverage for logic that shapes what a cold-sandbox turn sees of history |
| `engines/sandbox_agent/usage.ts` | `sandbox-agent-usage.test.ts` | 94.7% | behavior | strong |
| `engines/sandbox_agent/workspace.ts` | `sandbox-agent-workspace.test.ts` | 89.2% | behavior | strong |
| `extensions/agenta.ts` | `extension-tools.test.ts` | 58.2% | behavior | light — only 9 tests for 141 statements on a core Pi delivery path |
| `sessions/alive.ts` | `session-alive.test.ts` | 67.9% | behavior | good pattern (fetch stub), some branches missed |
| `sessions/auth.ts` | *(none)* | **0%** | — | `refreshCredential` entirely untested |
| `sessions/contract.ts` | `session-redis-contract.test.ts` | 100% | behavior | strong |
| `sessions/interactions.ts` | `session-interactions.test.ts` | 42.1% | **split** | only `createInteraction`'s happy/retry path tested; `buildWorkflowReferences`, `resolveInteraction`, `cancelStaleInteractions` all **0%** |
| `sessions/persist.ts` | `session-persist.test.ts` | 74.2% | behavior | good coverage of coalescing/retry/drain |
| `tools/callback.ts` | *(none)* | **7.4%** | — | `callAgentaTool` — the one shared `/tools/call` transport — essentially untested |
| `tools/client-tool-relay.ts` | n/a | n/a | — | types-only, no runtime code |
| `tools/code.ts` | `code-tool.test.ts` | 100% | behavior | 1 test, small surface |
| `tools/direct.ts` | `tool-direct.test.ts` (45 tests) | 91.9% | behavior | strong, incl. SSRF-guard and secret-leak checks |
| `tools/dispatch.ts` | `tool-dispatch.test.ts`, `tool-dispatch-permission.test.ts` | 92.2% | behavior | strong |
| `tools/mcp-bridge.ts` | `tool-bridge.test.ts`, `mcp-servers.test.ts`, `session-mcp-layering.test.ts` | 100% | behavior | strong (of mcp-bridge.ts itself; see tool-mcp-http.ts below for the gap it hides) |
| `tools/public-spec.ts` | (indirect via `extension-tools.test.ts`, `sandbox-agent-run-plan.test.ts`) | 100% | detail | no dedicated assertions of `advertisedToolSpec`/`executableToolSpecs` shape, just incidental use |
| `tools/relay.ts` | `tool-bridge.test.ts`, `tool-direct.test.ts`, `tool-dispatch.test.ts`, `tool-relay-permission*.test.ts` | 84.7% | behavior | strong overall |
| `tools/spec-schema.ts` | `spec-schema.test.ts` | 100% | behavior | strong |
| `tools/tool-mcp-http.ts` | *(only indirectly, via `mcp-bridge.ts` consumers)* | 71.3% | **split** | happy path (`tools/list`/single `tools/call`) covered; batch requests, `MAX_BODY_BYTES` rejection, malformed JSON (400), non-POST (405), and the abort/`MCP_PAUSED` pause-suppression logic are **all uncovered** |
| `tracing/otel.ts` | `otel-skills-error.test.ts`, `responder.test.ts`, `stream-events.test.ts`, `startup-banner.test.ts`, `sandbox-agent-orchestration.test.ts` (indirect) | 68.5%/53.6% branch | **split** | span lifecycle/state-machine has some coverage; the OpenInference/GenAI attribute-mapping functions (`emitMessages`, `applyAssistant`, tool-call/result rendering, usage/cache/cost fields) are **largely uncovered** — 1315 lines, the biggest file in `src/` |
| `version.ts` | (indirect, via `server.test.ts` `/health`) | 100%* | detail | no dedicated test of `runnerInfo()` shape beyond what `/health` incidentally checks |

\* "100%" here means every statement executed at least once somewhere in the suite, not that
the function's actual decision logic (env-var precedence, trailing-slash trim) is directly
asserted.

## Strengths — keep this

1. **Seam discipline is real, not aspirational.** `createAgentServer(run)` / `runCli(raw, stream, io)`
   are used consistently across `tests/unit/server.test.ts`, `tests/integration/server-smoke.test.ts`,
   and `tests/acceptance/server-contract.test.ts`. All three bind real loopback HTTP servers on
   port 0 (OS-assigned) with a fake engine — no live Pi/Claude/sandbox-agent, no real network
   beyond loopback, no port collisions.
2. **Graceful-shutdown testing is genuinely good.** `tests/unit/server.test.ts`
   (`registerShutdownHandler` describe block, ~line 233) drives `process.emit("SIGUSR2", ...)`
   against dependency-injected `exit()`/`onCleanup()` callbacks — avoids touching real
   `SIGTERM`/`SIGINT` (which would kill the test runner) while still proving: cleanup-then-exit,
   cleanup-rejects-but-still-exits (a failing Daytona delete must never hang shutdown), and
   idempotency (a repeated signal doesn't double-run cleanup). This is exactly the kind of
   test most projects skip.
3. **Cross-language wire-contract pinning is excellent.** `tests/unit/wire-contract.test.ts` +
   `tests/unit/permission-parity.test.ts` load the SAME golden JSON files
   (`sdks/python/oss/tests/pytest/unit/agents/golden/`) that the Python side asserts in
   `test_wire_contract.py`, with a compile-time key-guard (`KNOWN_REQUEST_KEYS as (keyof
   AgentRunRequest)[]`) so a drifted `protocol.ts` fails `tsc`, plus deep runtime assertions on
   every nested field (tool axes, skills, sandbox permission, tracing propagation). The
   commentary explaining *why* each assertion exists is unusually good documentation-as-test.
4. **The acceptance suite is a real contract test, not a smoke test.** `server-contract.test.ts`
   systematically covers status codes + response shape for every route (`/health`, `/run`
   JSON + NDJSON, `/stream` alias, `/kill`, 404), both auth-gate states, and both bearer/header
   auth forms — 16 tests, each named after the exact behavior it proves.
5. **Security-relevant env handling is thoroughly tested where it matters most.**
   `sandbox-agent-daemon.test.ts`'s `buildDaemonEnv` tests assert the full
   `KNOWN_PROVIDER_ENV_VARS` inventory (all 8 direct provider keys + AWS/GCP/Azure cloud
   groups) is cleared on a managed run and preserved on a non-managed run — a real security
   property (Rule 5, clear-then-apply), not just a shape check.
6. **Fakes are structurally, not just nominally, typed against the real SDK.**
   `SandboxAgentDeps` (in `engines/sandbox_agent.ts`) types its injectable seams as
   `typeof SandboxAgent.start`, `typeof buildDaemonEnv`, etc. — actual function types from the
   real modules, not a hand-maintained parallel interface. `pnpm run typecheck` passing clean
   is real evidence the test fakes have not silently drifted from the real `sandbox-agent`
   package's shape.
7. **CI wiring is already solid.** Typecheck + unit + integration + acceptance run as four
   separate CI jobs (`.github/workflows/12-check-unit-tests.yml`), each publishing JUnit
   results, gated sensibly (skips on draft PRs, respects `workflow_dispatch` package
   selection), with an explicit comment that the runner-tests job intentionally has **no**
   "has_tests" skip guard, so an empty/broken suite fails loud rather than silently passing.

## Findings

### 1. [blocker] No automated regression test exists for any real captured agent run — despite dozens sitting ready in the QA matrix

The manual QA effort (`docs/design/agent-workflows/projects/qa/`) has produced ~70 real
captured `/run` request/response pairs across environments, harnesses, and capabilities
(`qa/runs/*.json`), a purpose-built skill for exactly this conversion
(`.agents/skills/agent-replay-test/SKILL.md`), and its own explicit call-out in
`qa/matrix.md`: *"When F-001 is fixed, E2/E3 flip to pass and this becomes the regression
test."* None of it has happened. `grep -rl "replay" services/runner/tests/` and a repo-wide
search for replay test files under `sdks/python/.../recordings/` both come back empty.

Today `tests/unit/sandbox-agent-orchestration.test.ts` exercises `runSandboxAgent` against a
**hand-built** fake ACP session (`fakeHarness()`), which encodes the author's mental model of
how Pi/Claude behave over ACP — useful and typesafe, but never checked against a real
transcript. Bugs like F-001 (append_system dropped on sandbox-agent) were only caught by
*manual* re-verification across several QA passes (2026-06-20 fail → 2026-06-25 fix
confirmed → 2026-06-25 re-run confirmed again) — exactly the kind of regression an automated
replay test would have caught for free on every subsequent PR.

**Recommendation:** pick 2-3 already-green QA cells and turn them into TS-side tests that feed
a *recorded* ACP transcript through `runSandboxAgent` (not the hand-tuned `fakeHarness`) and
assert the real captured output shape. Start with the F-001 append_system regression (it's
explicitly flagged as "should become the regression test") and the code-tool / builtin-bash
happy path (already captured in `qa/runs/E2__code_tool_pi_core.json` etc.). This is a new
artifact — the existing `agent-replay-test` skill targets the Python SDK layer
(`sdks/python/.../recordings/`), which pins the *SDK's* handling of a runner result, not the
TS runner's own orchestration; a TS-side sibling is what's actually missing here.

**Files:** `services/runner/tests/unit/sandbox-agent-orchestration.test.ts`,
`docs/design/agent-workflows/projects/qa/runs/*.json`, `docs/design/agent-workflows/projects/qa/matrix.md`.
**Horizon:** short.

### 2. [high] `tools/tool-mcp-http.ts` — Claude's only tool delivery channel — has untested batch/abort/pause/error paths

71.3% statement coverage, but every uncovered line is a real failure or edge-case path, not
dead code: the JSON-RPC **batch** request branch (array of messages, lines ~319-337), the
`MAX_BODY_BYTES` request-too-large rejection (~252-255), malformed-JSON 400 handling
(~306-314), the non-POST 405 response (~295-297), and — most concerning — the
`MCP_PAUSED`-sentinel / abort-on-signal logic (~386-404) that deliberately destroys an
in-flight HTTP socket with no body so a paused `client` tool call doesn't settle late. All
current coverage of this file is *incidental*, via `tool-bridge.test.ts` /
`mcp-servers.test.ts` / `session-mcp-layering.test.ts`, which build the server through
`buildToolMcpServers` (`mcp-bridge.ts`) and only ever send a single well-formed request.
Given this file's own docstring says it "REPLACES the pre-#4831 stdio bridge" and is the sole
way Claude receives gateway/callback/client tools in production, its pause/abort/error paths
deserve direct tests against `startInternalToolMcpServer` itself.

**File:** `services/runner/src/tools/tool-mcp-http.ts`. **Horizon:** short.

### 3. [high] `tracing/otel.ts`'s attribute-mapping logic is the least-tested part of the biggest file in `src/`

1315 lines, 68.5%/53.6% branch coverage — the lowest branch coverage of any src file. The
uncovered ranges are concentrated in `emitMessages`, `applyAssistant`, `toolResultText`, and
the token/cache/cost attribute emission (`gen_ai.usage.*`, `gen_ai.response.finish_reasons`,
etc.) — pure functions (`Span` in, `setAttribute` calls out) that are cheap to unit test with
a fake `Span` but currently aren't. This is exactly the class of bug the project has been
bitten by before: a shape mismatch here doesn't throw, it just silently drops a field from a
trace, discovered only later by reading Agenta's UI (see prior incident:
`ag.metrics.duration.cumulative` intentionally scalar; and the QA matrix's own F-029 "skills
invisible in traces" / F-030 "error runs carry only a count, no message" findings — both are
this same class of otel-shape gap, found manually, that a direct unit test on these functions
would catch immediately and for free.

**File:** `services/runner/src/tracing/otel.ts`. **Horizon:** short-medium.

### 4. [high] `resolveDaemonBinary()` — the sandbox-agent binary lookup — has zero test coverage

`daemon.ts` is 44.7% covered overall, but that number is misleading: `buildDaemonEnv` (the
security-critical clear-then-apply half) is thoroughly tested (see Strengths #5);
`resolveDaemonBinary()` (env-var override → platform CLI package → pnpm-store directory scan
→ not-found) is **completely untested**, 0 of its statements executed by any test. This is
boring, load-bearing, three-branch fallback logic — precisely the kind that breaks silently
when a Docker base image's `node_modules/.pnpm` layout shifts, or a new platform/arch
combination is added, and the failure mode is "every run fails at daemon startup," not a
localized bug. It's easily testable by mocking `node:fs`'s `existsSync`/`readdirSync` to drive
each branch plus the not-found case.

**File:** `services/runner/src/engines/sandbox_agent/daemon.ts` (lines 24-50).
**Horizon:** short.

### 5. [medium] `sessions/interactions.ts` — three functions at 0%, all turn-lifecycle-critical

Only `createInteraction`'s happy/retry path is tested (`session-interactions.test.ts`).
Completely untested:
- `buildWorkflowReferences` — shapes which workflow/variant/revision an interaction record
  carries, so a later respond-invoke re-resolves the *same* revision. A bug here means a
  resumed approval could silently re-resolve the wrong revision.
- `resolveInteraction` — transitions an interaction to `resolved` after the runner forwards a
  stored decision to the harness.
- `cancelStaleInteractions` — cancels orphaned pending-approval gates from a prior turn when
  the user sends a new message instead of answering. A bug here leaves stale gates that block
  or confuse a later turn.

All three are fire-and-forget/best-effort by design (errors are logged and swallowed), which
is exactly why they need tests: a regression fails silently in production with no crash to
notice. The existing `createInteraction` test already establishes the fetch-mocking pattern to
extend to these.

**File:** `services/runner/src/sessions/interactions.ts` (lines 20-37, 97-119, 127-145).
**Horizon:** short.

### 6. [medium] `sessions/auth.ts`'s `refreshCredential` is completely untested

0% coverage, no test file references it. This re-mints the runner's short-lived (~15 min TTL)
Secret token so a long-running turn doesn't lose auth mid-run. A silent regression means turns
that exceed the TTL start failing auth partway through, with no test surfacing it beforehand.
Small (23 lines) and follows the same `vi.stubGlobal("fetch", ...)` pattern already
established in `sessions/alive.ts` and `sessions/interactions.ts` — cheap to add.

**File:** `services/runner/src/sessions/auth.ts`. **Horizon:** short.

### 7. [medium] `tools/callback.ts`'s `callAgentaTool` — the one shared `/tools/call` transport — is 7.4% covered

Per its own docstring this is the single implementation of the tool round-trip used by both
the Pi-extension path and the MCP-bridge path, specifically so "a change to the `/tools/call`
contract is a one-line edit, not several." Untested: the `AbortSignal.any` timeout-combination
logic, non-2xx response handling, all three response-body-parse branches (string `content`,
object `content` re-stringified, non-JSON fallback to raw body), and the transport-error → thrown
`Error` mapping. A regression here breaks every tool call on every harness, silently until a
real run fails.

**File:** `services/runner/src/tools/callback.ts`. **Horizon:** short.

### 8. [medium] Fakes are structurally typed but not behaviorally verified — document the residual risk

`fakeHarness()` in `sandbox-agent-orchestration.test.ts` (and similar inline fakes elsewhere)
are hand-rolled duck-typed plain objects for the ACP session/sandbox. `SandboxAgentDeps`
typing them against `typeof SandboxAgent.start` etc. (real SDK function types) does catch a
*shape* drift at `tsc` time (a real strength, see Strengths #6) but cannot catch a *behavioral*
drift: whether the real `sandbox-agent` package's `prompt()` really never resolves after a
permission pause the way the `hangPrompt` fake option assumes, whether event ordering
guarantees the fakes encode actually hold, or whether a new SDK version changes error object
shapes without changing the type signature. This is an inherent limit of any seam-based fake,
not a bug — but it's exactly what finding #1 (recorded-transcript replay tests) would give
periodic, low-cost verification against.

**Files:** `services/runner/tests/unit/sandbox-agent-orchestration.test.ts`.
**Horizon:** medium.

### 9. [medium] Duplicated test setup wants shared `tests/utils/` helpers

- The `listen(run)` helper (start `createAgentServer`, bind an ephemeral loopback port, return
  `{url, close}`) is copy-pasted **verbatim** in `tests/unit/server.test.ts`,
  `tests/integration/server-smoke.test.ts`, and `tests/acceptance/server-contract.test.ts`.
- A hand-rolled `mkdtempSync(join(tmpdir(), "..."))` + cleanup pattern is repeated across at
  least 14 unit test files (`sandbox-agent-daytona`, `tool-dispatch`,
  `sandbox-agent-workspace`, `permission-record-fixture`, `sandbox-agent-usage`,
  `sandbox-agent-run-plan`, `sandbox-agent-pi-error`, `tool-dispatch-permission`,
  `sandbox-agent-pi-assets`, `tool-direct`, `tool-relay-permission*.test.ts`, `tool-bridge`).

`tests/utils/` currently holds only `golden.ts`. Extracting `listenServer(run)` and a
`withTempDir()` helper means a future change to server-bootstrap or temp-dir cleanup
discipline is a one-file fix instead of an N-file grep-and-replace, and gives new tests an
obvious default to reach for instead of reinventing the pattern (there's already a lot of
`AGENTS.md`-encouraged growth in this test suite; this duplication only gets worse).

**Files:** the helper is duplicated across 3 server test files and inlined in 14+ others.
**Horizon:** short (cheap, high leverage).

### 10. [medium] No test exercises concurrent `/run` requests, and `destroyInFlightSandboxes` has no direct test at all

Every test in the suite drives one request at a time against `createAgentServer`. Nothing
proves that two overlapping `POST /run` calls (a realistic production scenario — a sidecar
handling concurrent playground sessions) don't interleave their NDJSON writes, that one run's
kill/abort doesn't touch another's in-flight sandbox, or that the shutdown-drain sweep
(`destroyInFlightSandboxes` in `engines/sandbox_agent.ts`) correctly races more than one
in-flight sandbox against its timeout. `destroyInFlightSandboxes` itself is not directly unit
tested at all today — its tracking `Set` is module-private with no exported seam, so the only
way to exercise its `Promise.allSettled`-races-a-timeout / swallow-errors behavior is a full
real run, which is why it isn't tested. `registerShutdownHandler`'s tests (Strengths #2)
verify the *signal-handling* half well; they inject a fake `onCleanup`, so they never actually
exercise `destroyInFlightSandboxes`'s own logic.

**Recommendation:** (a) add a concurrency test firing 2+ overlapping `POST /run` requests with
fake engines that resolve out of order, asserting responses don't cross-contaminate; (b) add a
minimal test-only export/reset hook for the in-flight sandbox set so `destroyInFlightSandboxes`
can be unit tested directly (seed 2-3 fake handles, one whose `destroySandbox` hangs past the
timeout, assert the sweep still resolves and doesn't throw).

**Files:** `services/runner/src/engines/sandbox_agent.ts` (lines 150-174),
`services/runner/tests/unit/server.test.ts`. **Horizon:** medium.

### 11. [low] Real timers everywhere — no test uses `vi.useFakeTimers()`

Every retry/backoff and polling test uses real wall-clock delays:
`sessions/persist.ts`/`sessions/interactions.ts`/`sessions/alive.ts` retry tests, and the
permission-relay poll loops in `tool-relay-permission*.test.ts` /
`tool-dispatch-permission.test.ts` (a `waitForFile` with a 1000ms real deadline). This is why
individual test files take 300ms-3.9s each for what is otherwise pure logic
(`tool-relay-permission-record.test.ts` alone is ~3.9s), and is a latent flakiness risk on a
loaded CI runner — none of it has flaked yet, but the pattern doesn't scale as more
retry/backoff logic is added. `grep -rl "useFakeTimers" tests/` returns nothing in the entire
suite.

**Recommendation:** switch the deterministic-retry-count cases to
`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()`; keep real timers only where a test
genuinely polls a real filesystem side effect and a fake clock wouldn't help.

**Horizon:** medium.

### 12. [low] `pnpm test` (the documented pre-push command) only runs the unit layer

`services/runner/AGENTS.md`'s "Before committing" section says "Run `pnpm test` and
`pnpm run typecheck` before pushing," but `package.json`'s `"test"` script is aliased to
`"test:unit"` only — it silently skips the integration and acceptance layers that CI runs as
separate jobs. A contributor following the documented checklist can push a change that breaks
`server-contract.test.ts` or `server-smoke.test.ts` and only discover it from CI.

**Recommendation:** either update the AGENTS.md instruction to list all three commands
explicitly, or change `pnpm test` to chain `test:unit && test:integration && test:acceptance`
to match what the instruction already implies.

**Files:** `services/runner/package.json`, `services/runner/AGENTS.md`. **Horizon:** short.

### 13. [low] No coverage thresholds, and `test:coverage` isn't wired into CI at all

`vitest.config.ts` has no `coverage` block (no `thresholds`, no `exclude` policy beyond
defaults). `test:coverage` is a local-only, developer-initiated report — it does not run in
any CI job. So a coverage regression on a security-relevant module (e.g., a new unclearved
branch added to `buildDaemonEnv`, or a new response path in `tools/callback.ts`) would not be
caught by CI, only by a human who happens to run the report.

**Recommendation:** add `coverage.thresholds` scoped at minimum to `sessions/**`,
`permission-plan.ts`, and `engines/sandbox_agent/daemon.ts` (the credential-handling/env-clearing
surface), and add a CI job running `test:coverage` — non-blocking at first if the thresholds
need calibrating, blocking once stable.

**Files:** `services/runner/vitest.config.ts`, `.github/workflows/12-check-unit-tests.yml`.
**Horizon:** medium.

### 14. [low] A few core-path files have moderate rather than strong coverage

`extensions/agenta.ts` (141 stmts, the Pi extension's `registerTools` — the actual wiring of
custom tools into Pi under sandbox-agent/ACP) is only 58.2% covered off 9 tests — light for a
core Pi delivery path. `cli.ts` (57.1%, 4 tests) and `server.ts` (64.4%, 15 tests) are also
moderate, though most of their uncovered lines are `main()`/`isEntrypoint()`/stdin-reading glue
that's inert during tests by design, not real logic gaps. Worth a look, lower priority than
findings 2-7.

**Horizon:** long.

## QA-matrix automation potential

The manual QA program (`docs/design/agent-workflows/projects/qa/`) is unusually rigorous:
`matrix.md` defines an environment × harness × capability product with explicit validity
rules, Gherkin scenarios with an "unguessable token + negative control" discipline, and ~70
real captured `/run` pairs under `qa/runs/`. Almost none of it is automated yet.

**Highest-value first automation — matches finding #1 above:** the F-001 append_system
regression. `matrix.md` explicitly flags it: *"When F-001 is fixed, E2/E3 flip to pass and
this becomes the regression test."* The team has already manually re-verified this exact
scenario three times across QA passes (2026-06-20 fail → 2026-06-25 confirmed fixed →
2026-06-25 second pass confirmed again) purely because no automated test exists to pin it.
That repeated manual cost, paid three times already, is the clearest signal of where a replay
test pays for itself immediately — and the request/result pairs are already captured
(`qa/runs/E2_2026-06-25__INV_append_system_pi_core.json` and siblings).

**Second-highest value:** the "Credential-isolation sub-scenarios" in `matrix.md` (provider-key
leak between runs — a security property, currently checked manually via a `leak_probe` code
tool). The matrix document itself notes these will only start meaningfully passing once the
`provider-model-auth` redesign lands — which is exactly when an automated version should exist,
so that redesign can prove itself continuously rather than via one more manual QA pass.

Both are TS-runner-observable without a live LLM if captured as recorded ACP transcripts
feeding `runSandboxAgent` directly (per finding #1): the actual assertion in both cases is
structural (did the built prompt text carry `append_system`; is a given provider env var
absent from the daemon's env), not model prose, which is exactly the kind of assertion the
`agent-replay-test` skill's own guidance recommends ("assert the structural facts a recorded
run proves ... not assistant prose").

## Top 10 (ranked, with the single highest-value item first)

1. **[blocker/short] Convert the F-001 append_system QA-matrix cell (already captured,
   already re-verified 3x manually) into a TS-side recorded-transcript replay test through the
   real `runSandboxAgent`.** This is the single highest-value missing test to add before
   launch — it eliminates the exact repeated-manual-verification cost the team has already
   paid three times, and it exercises the real orchestration path finding #1/#8 point out is
   otherwise only unit-tested against hand-built fakes.
2. [high/short] Unit-test `tool-mcp-http.ts`'s batch/abort/pause/malformed-body paths directly
   — it's Claude's only tool delivery channel and the untested lines are all real failure
   modes, not dead code.
3. [high/short] Unit-test `otel.ts`'s attribute-mapping functions (`emitMessages`,
   `applyAssistant`, tool-call/result rendering, usage/cache/cost) against a fake `Span` —
   this class of bug has already bitten the project (F-029/F-030, the duration-scalar
   incident) and is cheap to test directly.
4. [high/short] Unit-test `daemon.ts`'s `resolveDaemonBinary()` fallback chain (env override /
   platform package / pnpm-store scan / not-found) via a mocked `fs` — currently 0% covered,
   and a regression here fails every run in an affected environment.
5. [medium/short] Unit-test `sessions/interactions.ts`'s `buildWorkflowReferences`,
   `resolveInteraction`, `cancelStaleInteractions` — all 0%, all fire-and-forget so bugs are
   silent, all following an already-established fetch-mock pattern.
6. [medium/short] Unit-test `sessions/auth.ts`'s `refreshCredential` (0% covered) — same
   fetch-mock pattern as neighboring session modules.
7. [medium/short] Unit-test `tools/callback.ts`'s `callAgentaTool` timeout/response-parse
   branches (7.4% covered) — the one shared `/tools/call` transport for every harness.
8. [medium/short] Extract `tests/utils/` helpers for the duplicated `listen(run)` server
   bootstrap (3 copies) and the `mkdtempSync` temp-dir pattern (14+ copies).
9. [medium/medium] Add a concurrent-`/run` test plus a test-only seam for
   `destroyInFlightSandboxes` so its timeout-race/error-swallow logic gets direct coverage.
10. [low/medium] Replace real-timer waits with `vi.useFakeTimers()` in retry/backoff and
    permission-poll tests; wire `test:coverage` into CI with thresholds on the
    credential/env-handling modules.
