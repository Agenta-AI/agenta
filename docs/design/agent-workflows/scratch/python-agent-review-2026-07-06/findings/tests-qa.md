# Python agent review — Tests and QA (Lane G)

## 1. Scope

Read and ran: `sdks/python/oss/tests/pytest/unit/agents/**` (incl. `golden/`, `adapters/`,
`tools/`, `connections/`, `platform/`, `mcp/`, `skills/`), `sdks/python/oss/tests/pytest/integration/agents/**`
(`test_transport_roundtrip.py`, `_fake_runner_backend.py`), `sdks/python/agenta/tests/agents/`,
`sdks/python/pytest.ini`, `sdks/python/run-tests.py`, and the CI workflows in `.github/workflows/`.
Cross-read the source under review (`services/oss/src/agent/`, `sdks/python/agenta/sdk/agents/`)
only to map tests to modules and to check specific claims, not to review its design (other lanes
own that). Read the runner review's executive summary and its `tests-qa.md` for reconciliation.

## 2. How it actually works — verified against code

**Layout and how it runs.** `sdks/python/pytest.ini:3-5` sets `testpaths` to `oss/tests/pytest`
and `ee/tests/pytest` only. `run-tests.py:52-63` (`_resolve_test_dirs`) builds its pytest
invocation from exactly those two roots, optionally suffixed with a layer
(`unit`/`integration`/`acceptance`). This matters: **`sdks/python/agenta/tests/agents/` is
outside both roots**, so neither `pytest` (default discovery) nor `run-tests.py` ever collects
it. See finding 1.

Three real layers exist under `oss/tests/pytest/{unit,integration}/agents/`:

- **Unit** (`oss/tests/pytest/unit/agents/`): 540 tests, no network, no subprocess, no LLM.
  Fakes come from `conftest.py`.
- **Integration** (`oss/tests/pytest/integration/agents/`): 4 tests in
  `test_transport_roundtrip.py`, marked `pytest.mark.integration`
  (`test_transport_roundtrip.py:28`). These spawn a real Python subprocess standing in for the
  runner and drive the real wire serializer and the real subprocess transport end to end.
- **Acceptance**: no `agents` subdirectory exists under `oss/tests/pytest/acceptance/` (checked;
  none found), so the agents surface has no acceptance-layer tests today.

**CI wiring.** `.github/workflows/12-check-unit-tests.yml`'s `run-sdk-unit-tests` job
(lines 138-192) runs `uv run python run-tests.py --layer unit`, gated on "not a draft PR"
(line 139-141) — this is the fast, always-on gate, and it covers only the unit layer.
Separately, `.github/workflows/14-check-pr-preview.yml` (lines 3-18, 63-71) fires on every
non-draft PR touching `sdks/python/**`, deploys a Railway preview, and calls
`.github/workflows/44-railway-tests.yml` with `layers: all` — that workflow's `run-sdk-tests`
job (line 440) runs `run-tests.py --layer "${{ matrix.layer }}"` across `unit`, `integration`,
and `acceptance`. So **the integration layer, including `test_transport_roundtrip.py`, does run
in CI automatically on PRs that touch the SDK** — just on the slower Railway-preview pipeline,
not the fast unit-only gate. Neither pipeline is listed as a required status check in the
repo's branch protection (`gh api repos/Agenta-AI/agenta/branches/main/protection` returns no
`required_status_checks` block) — a repo-wide governance gap, not specific to this lane.

**Golden wire-contract pinning.** `test_wire_contract.py:1-14` states the intent directly: the
golden fixtures in `golden/` are "the shared anchor" between `wire.py` (Python producer) and
`protocol.ts` (TS consumer). Five fixtures exist: `run_request.pi_core.json`,
`run_request.claude.json`, `run_result.ok.json`, `run_result.error.json`, and
`permission_decisions.json`. `test_wire_contract.py:49-77` (`KNOWN_REQUEST_KEYS`) is a closed
set of every top-level wire key `request_to_wire` may emit; `test_request_to_wire_emits_only_known_keys`
(line 483) fails if a new key appears without the set being updated — the Python-side mirror of
the runner's compile-time `KNOWN_REQUEST_KEYS as (keyof AgentRunRequest)[]` guard confirmed by
the runner tests-qa report. `test_wire_models.py` separately validates the golden fixtures
against `wire_models.py`'s JSON-Schema export (lines 87-108) — confirming the "three-mirror"
setup lane B is asked to judge is real: `wire.py` (hand dict) and `wire_models.py` (a second
pydantic mirror) are both tested, but that is two things to keep in sync by hand, and the tests
enforce agreement rather than eliminate the duplication.

**Fake/seam discipline.** `conftest.py:30-102` defines `FakeSandbox`, `FakeSession`, and
`FakeBackend` as literal subclasses of `agenta.sdk.agents.interfaces.Backend` / `Sandbox` /
`Session` (`conftest.py:26,30,44,105`), not duck-typed stand-ins. The docstring
(`conftest.py:3-7`) states the reasoning: if a port grows an abstract method, the fake fails to
*instantiate*, not just fails a type check — a stronger guarantee than the runner side's
structurally-typed-but-still-plain-object fakes (confirmed against the runner `tests-qa.md`
finding 8). `_fake_runner_backend.py:36,50,123` (`FakeRunnerSandbox`, `FakeRunnerSession`,
`FakeRunnerBackend`) does the same against the same ports, and additionally routes through the
real `request_to_wire` / `result_from_wire` / `deliver_subprocess_result` /
`deliver_subprocess_stream` (`_fake_runner_backend.py:26-32,153-179`) — only the runner program
itself is faked (a tiny Python script), so `test_transport_roundtrip.py` exercises the real
serialization and the real subprocess transport, not a mock of either.

**Cross-language permission parity.** `tools/test_permission_parity.py:1-18` asserts the Python
`effective_permission` helper against the exact same `golden/permission_decisions.json` fixture
that `services/runner/tests/unit/permission-parity.test.ts` asserts on the TS side (confirmed
against the runner review), filtering to `"python": true` cases since the Python helper only
ever sees a subset of the inputs. This is a second, independent instance of true cross-language
golden pinning, not just the wire shape.

**Doc drift found.** `sdks/python/agenta/tests/agents/test_streaming.py:12` tells a reader to
run `uv run pytest agenta/tests/agents/test_streaming.py` — a real, working command — but gives
no hint that this directory is invisible to both plain `pytest` (excluded by
`testpaths`) and `run-tests.py`, so nobody running the documented CI/test commands will ever
execute it. See finding 1 for the consequence.

## 3. Strengths — keep this

1. **Ports-as-ABCs make the fakes self-checking.** `conftest.py`'s and
   `_fake_runner_backend.py`'s fakes are real subclasses of `Backend`/`Sandbox`/`Session`. A
   port change that isn't reflected in a fake breaks test collection immediately, not silently.
2. **The wire-contract golden fixtures are a real cross-language contract, not a convention.**
   `test_wire_contract.py` + `test_wire_models.py` + the shared `golden/` directory, read
   together with the runner's `wire-contract.test.ts` (confirmed from the runner review), give a
   drift in `request_to_wire`/`protocol.ts` nowhere to hide.
3. **`test_transport_roundtrip.py` is a real, if narrow, end-to-end test.** It is the one place
   in the Python suite that drives the actual subprocess transport and actual wire
   serialization without mocking either — closer to a real run than anything else in scope.
4. **Permission-decision parity is asserted against the same fixture as the TS suite.**
   `tools/test_permission_parity.py` + `golden/permission_decisions.json`, with an explicit
   comment refusing to "bend the fixture to make it pass."
5. **The Vercel stream adapter has serious test investment.** `test_ui_messages.py` (677
   lines), `adapters/test_vercel_stream_park.py` (717 lines), `test_vercel_stream_finish_reason.py`
   (168 lines), and `test_vercel_stream_continuation.py` (41 lines) total roughly 1,600 lines of
   tests against a 675-line source file (`adapters/vercel/stream.py`). This refutes the review
   prompt's assumption that `stream.py` was an under-tested candidate; it is one of the
   better-tested modules in the tree (see finding 9 for the caveat).
6. **Behavior-first assertions, not implementation snooping.** Spot-checked files
   (`test_environment_lifecycle.py`, `test_fold.py`, `test_wire_contract.py`,
   `tools/test_permission_parity.py`) assert observable outcomes (wire shapes, isolation
   guarantees, parsed results) rather than call counts or private state.

## 4. Findings

### 1. [high] `sdks/python/agenta/tests/agents/` is invisible to `pytest`/CI and currently has a broken test in it

`pytest.ini:3-5` scopes `testpaths` to `oss/tests/pytest` and `ee/tests/pytest`. `run-tests.py`
(the command every CI job and the documented pre-push workflow uses) only ever targets those two
roots. `sdks/python/agenta/tests/agents/test_streaming.py` sits outside both, so it never runs
under the standard commands, only if someone invokes `pytest agenta/tests/agents` directly.

Running it directly surfaces a live bug the orphaning has hidden:
`test_cli_stream_terminal_only_on_empty_request` (`test_streaming.py:151-167`) builds
`agent_dir = Path(__file__).resolve().parents[5] / "services" / "agent"` (line 152) and tries to
run `pnpm exec tsx src/cli.ts` there. `services/agent` does not exist; the runner now lives at
`services/runner`. The test's only skip guard is `@pytest.mark.skipif(shutil.which("pnpm") is
None, ...)` (line 150), which checks for `pnpm`, not for the directory. On any machine with
`pnpm` installed (confirmed locally), the test crashes with
`FileNotFoundError: [Errno 2] No such file or directory: '.../services/agent'` instead of
skipping or passing.

**Concrete failure scenario:** a contributor follows `AGENTS.md`'s testing guidance, runs the
whole `agenta/tests/agents` directory locally (as the file's own docstring instructs), and hits
a hard crash that looks like a broken dev environment rather than a four-line path fix — while
CI stays green because it never touches this directory at all.

**Recommendation:** move `sdks/python/agenta/tests/agents/` under `oss/tests/pytest/` (or add it
to `testpaths`) so it is actually exercised by `run-tests.py` and CI. While moving it, fix line
152 to point at `services/runner`, and change the skip condition to check the directory exists,
not just that `pnpm` is on PATH.

**Files:** `sdks/python/pytest.ini:3-5`, `sdks/python/run-tests.py:52-63`,
`sdks/python/agenta/tests/agents/test_streaming.py:150-167`. **Horizon:** short.

### 2. [high] The canonical SDK handler seam (`AgentComposition` / `make_agent_handler` / `agent_v0`) has zero direct test coverage

`handler.py:79-98` (`AgentComposition`), `handler.py:109-178` (`make_agent_handler`), and
`handler.py:250` (`agent_v0 = make_agent_handler()`) are the injectable composition seam the
module's own docstring calls "the canonical agent handler" (`handler.py:1-4`). Grepping the
entire scope for `make_agent_handler`, `AgentComposition`, and `agent_v0` returns no hits in any
test file. The only piece of `handler.py` touched by a test is `agent_event_stream`, and only
incidentally, via one import in `adapters/test_vercel_stream_finish_reason.py:21`.

This is exactly the seam the runner review's A-14 says `services/oss/src/agent/app.py`
duplicates instead of calling (confirmed from this side: `app.py:42` imports `agent_batch` and
`agent_event_stream` directly from `handler.py`, but builds its own template/tool/connection
composition inline rather than constructing an `AgentComposition` — the two copies can drift and
nothing here would catch it).

**Concrete failure scenario:** someone changes a default in `AgentComposition` (e.g. what
`_default_select_backend` does, `handler.py:59-62`) expecting every caller of `make_agent_handler`
to pick it up. `app.py` never calls `make_agent_handler`, so its own inline backend-selection
logic silently keeps the old behavior. No test in this lane's scope would fail either way,
because no test drives `make_agent_handler`/`AgentComposition` at all.

**Recommendation:** add a unit test that calls `make_agent_handler()` with a `FakeBackend`-backed
`AgentComposition` (the fakes already exist in `conftest.py`) and asserts the full request →
resolved tools/MCP/connection → harness → stream/batch path end to end, both with defaults and
with an injected composition. This is also the natural place to assert, structurally, that
`app.py`'s composition and `AgentComposition`'s defaults agree on the fields both sides set.

**Files:** `sdks/python/agenta/sdk/agents/handler.py:79-178,250`,
`services/oss/src/agent/app.py:42`. **Horizon:** short.

### 3. [high] `tracing.trace_context()` — the function that decides whether the caller's bearer token rides into every run — has no test

`tracing.py:41-76` (`trace_context()`) is, by its own docstring (lines 44-50), the producer of
exactly the design the runner review's A-1/A-2 and security F2 findings flag: "The caller's
credential rides along (via `inject`'s `Authorization` re-emit ...) — the runner authenticates
its session-coordination calls AS the caller with it." This is the function that builds the
`TraceContext` whose `authorization` field lands in the wire's
`telemetry.exporters.otlp.headers.authorization` (confirmed directly in
`golden/run_request.pi_core.json:18-23`, `"authorization": "Access tok-123"`).

No test calls `trace_context()`. `test_tracing.py` (86 lines) tests only `run_context()`'s
independent-failure-domain behavior (workflow capture failing independently of trace capture);
it never touches `trace_context()` or `record_usage()`. `test_wire_contract.py` constructs
`TraceContext(...)` objects by hand (line 139-144) to build golden payloads — it never calls
the real capture function, so a regression in `inject()`'s header extraction, in the
`ag.tracing.otlp_url` lookup (line 61-65), or in the best-effort `except Exception` swallow
(line 74-76) would not be caught by anything in this suite.

**Concrete failure scenario:** a future change makes `inject({})` include a wider credential
(or a second header) than intended. `trace_context()`'s broad `except Exception: return None`
means a partial regression here fails silently — the run either loses tracing entirely (caught
nowhere) or ships an unintended header (caught nowhere), because the one function that decides
this has no test asserting its actual behavior against `TracingContext`.

**Recommendation:** add unit tests for `trace_context()` directly: happy path (a
`TracingContext` with credentials and a traceparent produces the expected `TraceContext`
fields), the failure-degrades-to-`None` path, and — most importantly for the security story —
an explicit assertion of exactly which header value ends up in `authorization`, so a future
change to scope or drop that credential is a one-assertion diff, not a silent behavior change.

**Files:** `sdks/python/agenta/sdk/agents/tracing.py:41-76`,
`sdks/python/oss/tests/pytest/unit/agents/test_tracing.py`. **Horizon:** short.

### 4. [medium] `tools/compat.py` — the legacy/persisted tool-shape coercion layer — has zero test references

`tools/compat.py:62-107` (`coerce_tool_config`) and `:110-146` (`coerce_tool_configs`) convert
legacy playground/persisted tool shapes (bare strings, the `composio` type alias at line 85-87,
the gateway-slug-parsing fallback at lines 36-48, the `function.name` OpenAI-style shape at
lines 99-102, and the `on_error="collect"` diagnostics path at lines 110-146) into canonical
`ToolConfig` values. Grepping the whole test scope for `compat`, `coerce_tool_config`, or
`coerce_tool_configs` returns nothing.

**Concrete failure scenario:** an old persisted agent config with a `composio`-typed tool, or a
bare `{"function": {"name": "..."}}` shape from a legacy playground save, fails to coerce (or
coerces to the wrong provider/action) and the agent silently loses that tool or crashes on load,
with no test anywhere that would have caught the regression before it reached a real workspace.

**Recommendation:** add direct unit tests for `coerce_tool_config`/`coerce_tool_configs`: the
`composio` alias, the gateway-slug fallback (valid and malformed slugs), the bare-string and
bare-name-without-type shapes, and both `on_error` modes.

**File:** `sdks/python/agenta/sdk/agents/tools/compat.py`. **Horizon:** medium.

### 5. [medium] No test pins the SDK's own version-skew story, because there is none to pin (confirms runner A-7)

The runner review's A-7 found the SDK never probes `/health` and still posts the deprecated
`/run` alias. From the Python side: `grep -n "health" sdks/python/agenta/sdk/agents/utils/ts_runner.py`
returns nothing. `deliver_http_result`/`deliver_http_stream` (`ts_runner.py:63-66,168-175`)
always POST directly to `<base_url>/run` with no prior capability or version check. There is
nothing to test here today because the behavior does not exist — this is a confirmation, not a
new gap, but it means a future `/health`-probing change will land with no existing test to
extend, only new tests to write from scratch.

**Recommendation:** no immediate action beyond what lane B/A already recommend upstream (add the
probe); when it lands, pair it with a unit test asserting the SDK degrades sanely against an
old/missing `/health` response.

**File:** `sdks/python/agenta/sdk/agents/utils/ts_runner.py:63-66,168-175`. **Horizon:** medium
(tracks the upstream fix).

### 6. [medium] The golden fixtures encode the credential-in-telemetry design; a fix to A-1 will fail these tests on purpose, but nothing here argues for the fix

`golden/run_request.pi_core.json:18-23` and `golden/run_request.claude.json` both carry
`telemetry.exporters.otlp.headers.authorization` as the vehicle for the platform credential.
`test_wire_contract.py`'s `test_request_to_wire_pi_matches_golden` (line 241) and the Claude
equivalent (line 381) assert this shape byte-for-byte. That is good regression-pinning
discipline in general, but it means the tests currently *lock in* the design the runner review's
A-1 wants replaced with a first-class `platform { endpoint, authorization }` block — a
consequence worth naming explicitly so whoever picks up A-1 knows to update the golden fixtures
deliberately (as `test_wire_contract.py:8-10`'s own comment instructs) rather than treat a
failing golden test as evidence the change is wrong.

**Recommendation:** no test change needed now; flag this explicitly in the A-1 fix's task
description so the golden-fixture update is planned, not a surprise.

**Files:** `sdks/python/oss/tests/pytest/unit/agents/golden/run_request.pi_core.json:18-23`,
`test_wire_contract.py:241,381`. **Horizon:** long (tied to A-1's own horizon).

### 7. [low] The subprocess transport's environment passthrough is untested, though it is dev-only today

`utils/ts_runner.py:107-123` (`deliver_subprocess_result`) and its streaming twin take an
`env: Optional[Dict[str, str]] = None` parameter and pass it straight to
`asyncio.create_subprocess_exec(..., env=env, ...)`. Passing `env=None` means the child inherits
the *entire* parent process environment — every caller in scope (`FakeRunnerBackend`,
`adapters/sandbox_agent.py`'s dev-mode subprocess path) omits `env`, so today's subprocess
transport always hands the runner subprocess the full API-server environment, not just the
resolved `secrets` that ride the wire body. `adapters/local.py:1-19` confirms this codepath is
currently dev-only (`LocalBackend` "NOT YET IMPLEMENTED"), so this is not yet a live
multi-tenant leak, but no test asserts what environment the child receives, so the moment this
path becomes production-reachable (Local Pi backend, Phase 3 per `local.py`'s own docstring)
there is no test to catch a leak.

**Recommendation:** when `LocalBackend`'s subprocess path is implemented, add a test asserting
the child process's env is scoped (not full passthrough), mirroring the runner's own
`buildDaemonEnv` clear-then-apply tests. Until then, low priority.

**File:** `sdks/python/agenta/sdk/agents/utils/ts_runner.py:107-123,204-220`. **Horizon:** long.

### 8. [low] `mcp/errors.py`, `connections/errors.py`, and `skills/errors.py` are only reached indirectly

None of these three files has a dedicated test file (unlike `tools/errors.py`, whose specific
exception classes are asserted by name across `tools/test_resolver.py` and
`platform/test_op_catalog.py`, 7 direct references). They are exercised only as a side effect of
`pytest.raises(SomeBroaderError)` in the resolver/model tests for their package
(`connections/test_resolver.py:83` catches `UnsupportedProviderError` but nothing enumerates the
full error taxonomy). This is a real gap but a shallow one: the resolvers that raise these
errors are themselves tested, so a completely broken error class would surface as a resolver
test failure. What would not surface is a wrong error *type* (e.g. the wrong subclass raised for
a given input), since no test asserts the specific class.

**Recommendation:** low priority; if picked up, add one test per package asserting each specific
error subclass is raised for its triggering input, not just "raises."

**Files:** `sdks/python/agenta/sdk/agents/mcp/errors.py`,
`sdks/python/agenta/sdk/agents/connections/errors.py`,
`sdks/python/agenta/sdk/agents/skills/errors.py`. **Horizon:** long.

### 9. [low] No coverage tooling is wired for the SDK; this report's coverage map is import-based, not statement-based

`pytest-cov` is not a dependency of `sdks/python` (`uv run --no-sync python -c "import
pytest_cov"` fails: `ModuleNotFoundError`), and no coverage config or CI job exists for the SDK,
unlike the runner side which runs `pnpm run test:coverage` locally (though also not gated in
CI). The coverage map below is built from import/reference tracing, not from executed-statement
percentages, so it can say "a module has no dedicated test" with confidence but cannot say what
fraction of a covered module's branches are actually exercised.

**Recommendation:** add `pytest-cov` as a dev dependency and a `--cov=agenta.sdk.agents
--cov-report=term-missing` option to `run-tests.py` (opt-in flag, not blocking), so the next
review of this area can work from real numbers the way the runner review did.

**Files:** `sdks/python/pyproject.toml`, `sdks/python/run-tests.py`. **Horizon:** medium.

### 10. [low] `sdks/python/oss/tests/pytest/acceptance/` has no `agents/` subdirectory

Confirmed by directory listing: the acceptance layer (which the runner side uses for its
16-test HTTP contract suite) has no agents-specific tests at all. Nothing here asserts the
`/invoke`/`/inspect` HTTP surface `services/oss/src/agent/app.py` exposes end to end within
Python's own test layers (a separate suite exists at
`services/oss/tests/pytest/unit/agent/`, outside this lane's scope, and it is unclear from this
lane whether any lane's scope actually runs it — worth the reduce step confirming, since it did
not appear in any lane's explicit scope list in section 4 of the review prompt).

**Recommendation:** confirm in the reduce step which lane (if any) actually runs
`services/oss/tests/pytest/unit/agent/`; if none does, that is a coordination gap in the review
itself, not a code gap.

**Horizon:** medium.

## 5. Top 10 priority list

1. **[high/short] Add a direct test for `handler.py`'s `AgentComposition`/`make_agent_handler`
   seam.** It is the canonical handler the whole SDK composes around and the exact seam the
   runner review's A-14 says `app.py` duplicates; nothing tests it directly today. (Finding 2.)
2. **[high/short] Add a direct test for `tracing.trace_context()`.** It is the Python-side
   producer of the credential-in-telemetry design the runner review's A-1/A-2/security-F2 flag;
   today its actual capture logic is untested, only a hand-built stand-in object is. (Finding 3.)
3. **[high/short] Fix and re-integrate `sdks/python/agenta/tests/agents/`.** It is outside
   `pytest.ini`'s `testpaths` and `run-tests.py`'s scan roots, so it silently never runs, and it
   currently contains a test that crashes on a stale `services/agent` path. (Finding 1.)
4. **[medium/medium] Add direct tests for `tools/compat.py`.** The legacy/persisted tool-shape
   coercion layer (composio alias, gateway-slug fallback, bare-string/name shapes,
   collect-vs-raise) has zero test references. (Finding 4.)
5. **[medium/medium] Wire `pytest-cov` into `run-tests.py`.** This review's coverage map is
   import-based; a real statement/branch coverage run would sharpen every future pass the way it
   did for the runner side. (Finding 9.)
6. **[medium/long] Flag the golden-fixture consequence of an A-1 fix explicitly** in whatever
   task picks up the first-class `platform` wire block, so the golden update is planned, not a
   surprise CI failure. (Finding 6.)
7. **[low/long] Add per-subclass error-type assertions** for `mcp/errors.py`,
   `connections/errors.py`, `skills/errors.py`. (Finding 8.)
8. **[low/long] Add an env-scoping test for the subprocess transport** once `LocalBackend`'s
   dev-mode Pi path is implemented and production-reachable. (Finding 7.)
9. **[medium/medium] Confirm, in the reduce step, whether any lane actually runs
   `services/oss/tests/pytest/unit/agent/`** (the test suite for `app.py`) — it fell outside
   every lane's explicit scope in the review prompt. (Finding 10.)
10. **[high/short] Convert one QA-captured `/run` transcript into a Python-side replay test** —
    see the Reconciliation section: this is the same blocker the runner review named, confirmed
    absent here too, and it is the single highest-value test to add before launch.

## Reconciliation with the runner review

**The runner review's second blocker — "no real agent run is pinned by a regression test" — is
true on the Python side too, for the same underlying reason.** The `agent-replay-test` skill
(`.agents/skills/agent-replay-test/SKILL.md`) exists and explicitly targets this SDK
(`sdks/python/oss/tests/pytest/unit/agents/conftest.py` for unit-tier replays, `golden/` for
wire-shape replays), but a repo-wide search for a `recordings/` directory or any replay fixture
under `sdks/python` returns nothing. The closest thing this suite has is
`test_transport_roundtrip.py`'s hand-written echo/fail/silent runner scripts
(`test_transport_roundtrip.py:33-99`) — useful, real-transport tests, but they encode the
author's model of what a runner does, not a captured real transcript, exactly the same
limitation the runner review names for its own `fakeHarness()`.

**This is one story, not two.** The runner side has ~70 captured `/run` pairs sitting unused in
`docs/design/agent-workflows/projects/qa/runs/`. The Python side has the skill to consume them
and nowhere they land. The single highest-value test to add before launch, from this lane, is
the same one the runner review names: pick one already-green QA cell (the runner review
suggests the F-001 append_system regression) and turn it into a Python-side test that feeds the
captured `/run` result through `result_from_wire`/`AgentStream`/`fold`, asserting the real
parsed shape — not a second TS-side test, but the Python-side sibling the `agent-replay-test`
skill was written for and that neither review found actually built.

**Other cross-references confirmed from this side:**
- **A-7** (no `/health` probe, still posts `/run`): confirmed — `ts_runner.py` has no reference
  to `/health` anywhere, and no test exists for version-skew behavior because the behavior
  doesn't exist yet. (Finding 5.)
- **A-1/A-2** (credential and API base smuggled through telemetry config): confirmed from the
  producer side. `tracing.trace_context()` is the function that puts the caller's bearer into
  `TraceContext.authorization`, which the golden fixtures pin into
  `telemetry.exporters.otlp.headers.authorization`. The function itself is untested (finding 3);
  the wire shape it produces is thoroughly tested (finding 6) — meaning the design is well
  pinned but the actual capture logic that feeds it is not.
- **A-14** (`app.py` re-implements `handler.py`'s composition seam instead of calling it):
  confirmed from the testing angle — `app.py` does call `agent_batch`/`agent_event_stream`
  directly but never constructs an `AgentComposition`, and neither side has a test that would
  catch the two drifting. (Finding 2.)
- **A-9** (the three-mirror wire contract at its ceiling): confirmed — both `wire.py` (via
  `test_wire_contract.py`) and `wire_models.py` (via `test_wire_models.py`) are independently
  tested against the same goldens, which proves the tests are doing their job but also proves
  there are genuinely two things to keep in sync.

## Test run results (2026-07-07)

Ran from `sdks/python` after `uv sync --locked`:

| Command | Result |
| --- | --- |
| `uv run --no-sync pytest oss/tests/pytest/unit/agents -q` | **540 passed** in 8.17s |
| `uv run --no-sync pytest oss/tests/pytest/integration/agents -q` | **4 passed** in 7.32s |
| `uv run --no-sync pytest agenta/tests/agents -q` | **5 passed, 1 failed** in 8.06s — the failure is `test_cli_stream_terminal_only_on_empty_request` (finding 1), and this whole run is not part of any documented or CI-driven command (finding 1) |

## Coverage map

"Behavior/detail" is this reviewer's read of whether the tests assert observable outcomes (wire
shapes, parsed results, isolation guarantees, cross-language parity) vs. internal call order.
Built from import/reference tracing (no statement-coverage tool is wired in; see finding 9).

| Source module | Test file(s) | Behavior/detail | Note |
| --- | --- | --- | --- |
| `dtos.py` | `test_dtos_agent_template.py`, `test_dtos_capabilities_events.py`, `test_dtos_content_blocks.py`, `test_dtos_harness_configs.py`, `connections/test_dtos_model_ref.py` | behavior | mostly declarative pydantic models; spread across five focused files rather than one |
| `wire_models.py` | `test_wire_models.py` | behavior | validated against the same goldens as `wire.py` (finding 6/A-9) |
| `utils/wire.py` | `test_wire_contract.py` (813 lines) | behavior | the strongest single test file in scope; closed-key-set + golden pinning |
| `capabilities.py` | `test_dtos_capabilities_events.py`, `connections/test_capabilities.py` | behavior | good |
| `handler.py` | *(none directly)* | — | `AgentComposition`/`make_agent_handler`/`agent_v0` untested; `agent_event_stream` only incidental (finding 2) |
| `interfaces.py` | `conftest.py`, `_fake_runner_backend.py` (as ABCs the fakes subclass) | behavior | tested by construction, not by a dedicated assertion file — reasonable for a ports file |
| `fold.py` | `test_fold.py` (373 lines) | behavior | strong, dedicated |
| `streaming.py` | `agenta/tests/agents/test_streaming.py` (orphaned, finding 1), `adapters/test_vercel_stream_*.py` (indirect) | behavior | the dedicated file is real but not run in CI |
| `tracing.py` | `test_tracing.py` (86 lines) | **split** | `run_context()` well tested; `trace_context()` and `record_usage()` untested (finding 3) |
| `permission_rules.py` | `tools/test_permission_parity.py` | behavior | cross-language golden parity |
| `adapters/harnesses.py` | `test_harness_adapters.py` (388 lines), `test_harness_identity.py` | behavior | strong |
| `adapters/claude_settings.py` | `adapters/test_claude_settings.py` (405 lines) | behavior | strong |
| `adapters/agenta_builtins.py` | `test_harness_adapters.py` | behavior | indirect but real |
| `adapters/sandbox_agent.py` | `test_harness_adapters.py`, `test_runner_adapter_config.py`, `_fake_runner_backend.py` | behavior | good |
| `adapters/local.py` | *(none; not yet implemented)* | — | raises `NotImplementedError`, nothing to test yet |
| `adapters/_runner_config.py` | `test_runner_adapter_config.py` | behavior | good |
| `adapters/vercel/stream.py` | `test_ui_messages.py`, `adapters/test_vercel_stream_park.py`, `test_vercel_stream_finish_reason.py`, `test_vercel_stream_continuation.py` | behavior | ~1,600 test lines for 675 source lines; strong (finding, strength 5) |
| `adapters/vercel/messages.py` | `test_ui_messages.py` | behavior | good |
| `adapters/vercel/routing.py`, `sse.py` | *(none directly found)* | — | small (24/25 lines); likely exercised transitively through `stream.py` tests, not asserted directly |
| `utils/ts_runner.py` | `test_runner_transport_auth.py`, `test_runner_batch_error_fidelity.py` | behavior | auth header and error-fidelity paths well covered; env-passthrough untested (finding 7) |
| `tools/models.py` | `tools/test_models.py` (261 lines) | behavior | strong |
| `tools/resolver.py` | `tools/test_resolver.py` (297 lines) | behavior | strong, incl. injectable-resolver contracts |
| `tools/parsing.py` | `tools/test_parsing.py` (210 lines) | behavior | strong |
| `tools/compat.py` | *(none)* | — | zero references (finding 4) |
| `tools/errors.py` | referenced by name across `tools/test_resolver.py`, `platform/test_op_catalog.py` | behavior | good |
| `connections/models.py` | `connections/test_models.py`, `connections/test_dtos_model_ref.py` | behavior | strong |
| `connections/resolver.py` | `connections/test_resolver.py` | behavior | good |
| `connections/errors.py` | indirect only (`pytest.raises` on broader errors) | detail | no per-subclass assertions (finding 8) |
| `mcp/models.py`, `resolver.py` | `mcp/test_resolver.py` | behavior | adequate for the module's size |
| `mcp/parsing.py`, `errors.py` | indirect only | detail | (finding 8) |
| `skills/models.py`, `parsing.py`, `wire.py` | `skills/test_models.py`, `test_parsing.py`, `test_wire.py`, `test_skills_e2e.py` | behavior | strong, incl. an e2e test |
| `skills/errors.py` | indirect only | detail | (finding 8) |
| `platform/op_catalog.py` | `platform/test_op_catalog.py` (529 lines) | behavior | validators tested directly; the catalog's ~1000 lines of data self-validate on import via pydantic model validators |
| `platform/connections.py` | `platform/test_connections_http.py` (361 lines) | behavior | tested — contrary to the review prompt's candidate-gap assumption |
| `platform/connection.py` | `platform/test_connection.py` | behavior | good |
| `platform/gateway.py` | `platform/test_gateway_http.py` | behavior | good |
| `platform/secrets.py` | `platform/test_secrets_http.py` | behavior | good |
| `platform/workflow.py` | `platform/test_workflow_resolver.py` | behavior | good |
| `platform/resolve.py` | `platform/test_resolve.py` (45 lines) | behavior | thin but the module is 109 lines of mostly delegation |
| `platform/_schema.py` | `platform/test_schema_expand.py` (178 lines) | behavior | good |
| `platform/platform_tools.py` | `platform/test_op_catalog.py` (via `AgentaPlatformToolResolver`) | behavior | tested together with `op_catalog.py`, not standalone |
| `services/oss/src/agent/app.py`, `config.py`, `schemas.py` | *(outside this lane's scope; a suite exists at `services/oss/tests/pytest/unit/agent/`, unclear which lane covers it)* | — | see finding 10 |

Coverage in this table is presence-of-a-test, not depth; see finding 9 for the tooling gap that
prevents a statement/branch-level version of this table.
