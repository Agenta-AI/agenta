# Python agent review — A. Architecture, boundaries, orchestration

Reviewer: A (system-level, Python side). Scope: `services/oss/src/agent/app.py` (328) +
`services/oss/src/agent/__init__.py`; SDK `sdks/python/agenta/sdk/agents/`: `handler.py` (250),
`interfaces.py` (296), `__init__.py` (271), `fold.py` (151), `streaming.py` (99),
`adapters/harnesses.py` (173), `adapters/local.py` (55), `adapters/sandbox_agent.py` (206),
`adapters/_runner_config.py` (54), `utils/ts_runner.py` (258). Read for context (not reviewed in
depth; they belong to lanes B/C/E/F): `dtos.py`, `utils/wire.py`, `capabilities.py`,
`services/oss/src/agent/config.py`, `schemas.py`, `tools/resolver.py`, `secrets.py`, the SDK
registry in `engines/running/utils.py`, and the compose files under `hosting/docker-compose/`.

Date: 2026-07-07. Reconciled against the runner review
(`../runner-review-2026-07-05/`), findings A-14, A-4, A-5, A-7, A-10, A-19.

---

## 1. How it actually works (verified against code, with doc drift noted)

**The pipeline.** The deployed container mounts the agent app at `/agent/v0`
(`services/entrypoints/main.py:46,139`). `create_agent_app` (`app.py:293-325`) binds a locally
defined `_agent` coroutine to the builtin URI `agenta:builtin:agent:v0`, replacing the
composition-default `agent_v0` the SDK seeds into `HANDLER_REGISTRY`
(`engines/running/utils.py:362`; replace semantics documented at `utils.py:412-424`).

**One turn** (`app.py:210-287`): parse flags, reject `force`; build the `AgentTemplate` from
`parameters.agent` with file-backed defaults (`AgentTemplate.from_params`, `dtos.py:608-641`);
resolve tools and MCP servers server-side (`app.py:232-233`, via `oss.src.agent.tools.resolver`,
which adds the `AGENTA_AGENT_MCPS_ENABLED` gate over the SDK resolvers, `tools/resolver.py:26-50`);
resolve exactly one least-privilege connection for the configured model, wrapped in a two-phase
harness capability check (pre-resolve provider/mode, post-resolve deployment,
`app.py:95-192`, table in `capabilities.py:145-238`) with graceful degradation to
`runtime_provided` for the unnamed-default case (`app.py:171-190`); bundle everything into a
`SessionConfig` (`app.py:255-270`); construct the harness over an `Environment` wrapping the
backend that `select_backend` picks (`app.py:276-278`); then stream or batch through the SDK's
shared `agent_event_stream` / `agent_batch` (`handler.py:181-247`), where batch is literally
`fold(stream)` (`fold.py:37-128`).

**The ports** (`interfaces.py`): `Backend` (engine; declares `supported_harnesses`, owns
sandbox+session lifecycle, `interfaces.py:96-133`) → `Sandbox` (process-tree home + `add_files`,
`interfaces.py:43-57`) → `Session` (`prompt`/`stream`, `interfaces.py:60-88`) → `Environment`
(sandbox policy over a backend, `interfaces.py:141-197`) → `Harness` (per-harness config mapping,
validates `backend.supports(harness_type)` at construction, `interfaces.py:205-296`). Adapters:
three harnesses in a registry dict (`adapters/harnesses.py:149-173`), one real backend
(`SandboxAgentBackend`, `adapters/sandbox_agent.py:123-193`), one stub (`LocalBackend`, all
methods `NotImplementedError`, `adapters/local.py`).

**Transport selection**: `SandboxAgentBackend` picks HTTP when a `url` is set, else the runner
CLI subprocess (`sandbox_agent.py:179-193`); the service passes `url=runner_url()`
(`AGENTA_RUNNER_INTERNAL_URL`) and `cwd=runner_dir()` (`app.py:195-207`,
`services/oss/src/agent/config.py:40-49`). Compose always sets the URL
(`hosting/docker-compose/*/docker-compose*.yml`, default `http://runner:8765`), so production is
HTTP; the subprocess path is the source-checkout dev fallback. Both transports live in
`utils/ts_runner.py`: the live path is NDJSON streaming (`deliver_http_stream:162-196`,
`deliver_subprocess_stream:199-258`); the one-shot `deliver_*_result` functions are explicitly
DEV-ONLY and unused (`ts_runner.py:47-54`, `sandbox_agent.py:109-115,179-185`).

**Doc drift found while verifying** (details in finding A-10):
- Eight SDK files still cite `services/agent/...` for the runner; the runner lives at
  `services/runner/` (`interfaces.py:239`, `dtos.py:212`, `utils/wire.py:4`, `skills/wire.py:5`,
  `adapters/local.py:6`, `adapters/claude_settings.py:56-58`, `wire_models.py:5`).
- `services/oss/src/agent/config.py:1` says the template is "read from `services/agent/config`";
  that directory does not exist (finding A-2 — this one is live behavior, not just prose).
- `config.py:19-20` says the defaults are "kept in sync with ... (schemas.py: `_DEFAULT_MODEL` /
  `_DEFAULT_AGENTS_MD`)"; `schemas.py` no longer has those names (it uses
  `build_agent_v0_default()`, `schemas.py:41`).
- `interfaces.py:14` lists the Harness adapters as "``PiHarness`` / ``ClaudeHarness``", omitting
  `AgentaHarness`.
- `app.py:274-275` says "The sandbox-agent backend supports all three harnesses" — true — but the
  neighboring claim in `select_backend`'s docstring ("``sandbox`` ... never enters
  ``SessionConfig``", `app.py:200-201`) is literally false: `agent.sandbox` rides inside
  `session_config.agent`; `dtos.py:944-945` admits no adapter reads it (see A-12).

---

## 2. Strengths — keep this

- **`batch = fold(stream)` by construction.** There is one event pipeline. The batch path drains
  the same stream and folds it (`handler.py:215-247`, `fold.py`); the corrective terminal `done`
  logic is mirrored deliberately between the two (`handler.py:193-206` vs `handler.py:235-237`).
  This kills the whole "batch and stream disagree" bug class. It is the single best structural
  decision on the Python side.
- **The composition seam exists and is well-shaped.** `AgentComposition` + `make_agent_handler`
  (`handler.py:79-178`) is exactly the right injectable seam: every field defaults to
  env/ambient-driven behavior, so a bare `agent_v0` works standalone. The problem is who does not
  use it (A-1), not its design.
- **Fail-loud discipline, mirrored from the runner.** `make_harness` raises on an unknown harness
  (`adapters/harnesses.py:165-173`); `Harness.__init__` raises `UnsupportedHarnessError` when the
  backend cannot drive it (`interfaces.py:216-218`); `resolve_runner_command` refuses a
  transportless backend at construction with an actionable message (`_runner_config.py:39-52`);
  `AgentStream` and both streaming transports fail loud on a truncated stream instead of leaving
  an opaque state (`streaming.py:80-85`, `ts_runner.py:195-196,244-254`); the service raises
  `MCPDisabledError` instead of silently stripping declared MCP servers
  (`tools/resolver.py:40-49`).
- **Error sanitization at exactly one boundary.** `sanitize_runner_error` (`utils/wire.py:54-75`)
  and `_transport_error` (`ts_runner.py:35-44`) keep stack/path detail in the logs and one clean
  line in the UI, and the HTTP transport deliberately recognizes the runner's result-shaped 500 so
  the actionable provider message survives (`ts_runner.py:69-104`).
- **Harness knowledge is mostly tables, not conditionals.** `HarnessType` +
  `HARNESS_IDENTITIES` (`dtos.py:43-106`), the `_HARNESSES` registry
  (`adapters/harnesses.py:149-153`), `HARNESS_CONNECTION_CAPABILITIES` (`capabilities.py:145-167`),
  `Backend.supported_harnesses` (`interfaces.py:104`). The Python side is meaningfully closer to
  the runner review's A-4 target than the runner is.
- **`AgentStream`'s lifecycle hooks.** `on_result` / `on_cleanup` with cleanup guaranteed on
  drain, break, or cancellation (`streaming.py:54-91`, used at `interfaces.py:296`) is a clean,
  composable answer to "who destroys the session".
- **Comments that carry the why.** The tolerant-vs-strict connection resolution rationale
  (`app.py:135-157`), the corrective-`done` note (`handler.py:193-198`), the omit-when-empty
  golden-contract notes on every `wire_*` fragment. Same virtue the runner review praised.

---

## 3. Findings

Severity: blocker / high / medium / low. Horizon: **short** = before/at launch, **medium** =
1-2 months, **long** = structural.

---

### A-1 (HIGH, short) — CONFIRMED runner A-14: the service re-implements `make_agent_handler`, and the two orchestrations have drifted in five places

**Where:** `app.py:210-287` (`_agent`) vs `handler.py:114-176` (the inner `_agent` of
`make_agent_handler`); `app.py:80-92` (`_agent_model_ref`) vs `handler.py:101-106` (verbatim copy).

**Quantified.** The service `_agent` is 78 lines; the SDK inner `_agent` is 63. A line diff shows
roughly 50 lines structurally identical modulo indentation and `comp.` prefixes, plus the 5-line
`_agent_model_ref` body copied verbatim. `app.py` imports `agent_batch` and `agent_event_stream`
from `handler.py` (`app.py:44`) — so the stream/batch/fold tail IS shared — but it does not import
`AgentComposition` or `make_agent_handler` at all. The seam's own field comment names the exact
use case the service implements around it: "override for capability gating (pre/post-resolve
harness checks)" (`handler.py:93-94`). Today `AgentComposition`'s only consumers are two unit
tests (`grep make_agent_handler|AgentComposition` across the repo: `handler.py`, two test files,
nothing else). The seam is decorative in the one place it was built for.

**Every place the two copies disagree** (this matters because the SDK copy is not dead code: it is
the seeded default handler for the SAME URI, `agenta:builtin:agent:v0`,
`engines/running/utils.py:362`):

1. **Connection resolution policy.** The service runs the two-phase harness capability check and
   degrades gracefully to `runtime_provided` when a default/self-managed connection fails to
   resolve (`app.py:131-192`). The SDK default is a bare `resolve_connection` that propagates
   every `ConnectionResolutionError` and applies NO capability gate (`handler.py:142-146`). So the
   default `agent_v0` fails hard where the service tolerates, and allows provider/harness
   combinations the service rejects. `app.py:99-101` claims the guard "is server-side so a direct
   API caller is checked too" — true only for callers that reach the service's copy.
2. **`run_kind`.** The service lifts `request.meta.run_kind` into `RunContext`
   (`app.py:249-253`, pinned by `services/oss/tests/pytest/unit/agent/test_run_kind.py`). The SDK
   handler ignores `request.meta` entirely. This is also the one customization that does NOT fit
   the current seam: every `AgentComposition` callable is request-blind (`run_context` is
   zero-arg, `handler.py:51`), so adopting the seam requires extending it.
3. **MCP gating.** The service routes MCP through the `AGENTA_AGENT_MCPS_ENABLED` gate with
   `MCPDisabledError` (`tools/resolver.py:26-50`); the SDK default resolves MCP unconditionally
   (`handler.py:69-72`).
4. **Backend selection.** Service: `runner_url()` + validated `runner_dir()` (`app.py:195-207`);
   SDK default: `AGENTA_RUNNER_INTERNAL_URL` + `os.getcwd()` (`handler.py:59-62`). Two independent
   reads of the same env var (`config.py:46-49` vs `handler.py:61`).
5. **Default template.** Service: file-backed `load_config()` (`app.py:70-77`; itself broken, see
   A-2); SDK: empty `AgentTemplate()` (`handler.py:55-56`).

Plus the second independent `AGENTA_RUNNER_TIMEOUT_SECONDS` read the runner review already named
(`ts_runner.py:16` module constant vs `sandbox_agent.py:137` class-definition default — both
frozen at import time; see A-5).

**Concrete failure scenario.** Any process that resolves `agenta:builtin:agent:v0` through the SDK
registry without the agent service's rebind — a standalone SDK user following the package
docstring, a test harness, or any future surface that reuses the builtin registry — runs the
drifted orchestration: a playground-default config with no vault key raises
`ConnectionResolutionError` instead of degrading to harness login; an anthropic-model-on-pi
misconfiguration passes unchecked; traces lose `run_kind`. Meanwhile every new run-level feature
(a wire field, a capability check, a streaming change) must be hand-added in two files or the two
silently diverge further — which is precisely how the five disagreements above accumulated.

**Recommendation.** Make `app.py` construct the composition and delete the duplicated body:

```python
composition = AgentComposition(
    default_template=_default_agent_template,
    resolve_tools=resolve_tools,
    resolve_mcp_servers=resolve_mcp_servers,
    resolve_session_connection=_resolve_session_connection,
    select_backend=select_backend,
)
_agent = make_agent_handler(composition)
```

Extend the seam for the one hook it lacks: make `run_context` (or a new `enrich_run_context`)
receive the `WorkflowServiceRequest`, defaulting to the current request-blind behavior. Decide
deliberately which of the five drifts is policy the DEFAULT should also have (the capability gate
arguably should ride the default `resolve_session_connection`, since it is a pure SDK-table check
— then a direct SDK user is protected too). Both sides have tests; this is a one-file refactor.
Horizon: short for adopting the seam (it removes a live behavioral fork on a public URI), medium
for deciding the default-policy question.

---

### A-2 (HIGH, short) — The service's default paths point at a directory that no longer exists: the editable-template feature is silently dead and the documented local-dev transport default is broken

**Where:** `services/oss/src/agent/config.py:14-16`
(`_DEFAULT_AGENT_DIR = _SERVICES_DIR / "agent"`), consumed by `runner_dir()` (`config.py:40-43`)
and `config_dir()` (`config.py:52-55`); `app.py:6-10` module docstring ("a local runner CLI in a
source checkout"); `_runner_config.py:46-52`.

**What.** The TypeScript runner was renamed `services/agent` → `services/runner`; `ls services/`
confirms `services/agent` does not exist. Nothing in `hosting/` sets `AGENTA_RUNNER_DIR` or
`AGENTA_AGENT_TEMPLATE_DIR` (grep over all compose/env files: zero hits). Consequences:

- `config_dir()` always resolves to a nonexistent directory, so `load_config()`
  (`config.py:58-78`) always falls through to the hard-coded hello-world defaults. The module's
  own promise — "The template ... lives in editable files so changing the agent does not need a
  code change" (`config.py:1-5`) — is silently false in every deployment and every checkout. No
  error, no log line.
- `runner_dir()` always resolves to the nonexistent default, so the subprocess fallback that
  `select_backend`'s docstring advertises ("local development spawns the TypeScript runner CLI
  from the runner dir", `app.py:198-200`) can never work without an env override:
  `resolve_runner_command` raises `AgentRunnerConfigurationError` (`_runner_config.py:46-52`). At
  least this half fails loud — but the failure message tells the developer to point `cwd` at a
  runner directory, not that the shipped default is stale.
- The unit test that covers this seam sets `AGENTA_RUNNER_DIR` to a tmp dir
  (`services/oss/tests/pytest/unit/agent/test_select_backend.py:30,65`), so no test exercises the
  shipped default. The break is invisible to CI.

**Concrete failure scenario.** An operator edits `services/agent/config/AGENTS.md` per the
docstring (or recreates it from old docs) and nothing changes; or a contributor unsets
`AGENTA_RUNNER_INTERNAL_URL` to use the documented CLI fallback and every agent run fails with a
configuration error pointing at a directory that is not in the tree.

**Recommendation.** One-line fix: `_DEFAULT_AGENT_DIR = _SERVICES_DIR / "runner"` — and decide
what `config_dir()` should be now (the runner repo has no `config/` template dir; either ship the
template dir under `services/runner/config`, point the default somewhere real, or delete the
file-template mechanism and keep the constants, which is what production has been running
anyway). Add a warning log when `load_config()` falls back so the next silent break is visible.
Fix the three stale docstrings while there. Horizon: short.

---

### A-3 (HIGH, short) — CONFIRMED runner A-7 from the Python side: no `/health` probe, no protocol check, still posting the deprecated `/run` alias

**Where:** `utils/ts_runner.py:66,175` (`base_url.rstrip("/") + "/run"`), `sandbox_agent.py`
(no probe anywhere; grep for `health` in the SDK agents tree: zero hits);
`interfaces.py:109-112` (`Backend.setup()` — the natural, currently no-op seam).

**What.** The runner exposes `/health` with `{runner, protocol, engines, harnesses}` precisely so
a client can detect an incompatible runner before the first run, and serves `/stream` as the
productized route with `/run` "kept for one release" (runner review A-7). The Python SDK — the
only production client — never calls `/health`, never checks `protocol`, and still posts `/run`.
Version skew between the api image and the runner image (independently tagged in Helm) is
silently absorbed: an old runner ignores new wire fields (the silent-drop class this codebase has
fought repeatedly), and the day the alias is removed, every run breaks with a bare 404 at
request time.

**Concrete failure scenario.** Helm bumps `agentRunner.image.tag` past the alias-removal release
while the api image lags one version: every agent run fails `Agent runner HTTP 404` with no hint
that the fix is a version mismatch.

**Recommendation.** Implement the probe in `SandboxAgentBackend.setup()` — the port already has
the lifecycle hook and the handler already calls `harness.setup()` on every path
(`handler.py:184,224`). Probe once per process (module-level cache keyed by URL), log a warning on
minor mismatch, raise `AgentRunnerConfigurationError` on a protocol major the SDK does not
support. Switch the two transports to `/stream` in the same change. Horizon: short; it is a small
diff and the runner side already shipped its half.

---

### A-4 (MEDIUM, medium) — The provisioning path is dead on the only real backend, and it plants harness knowledge in the port base class

**Where:** `interfaces.py:235-251` (`Harness._provisioning`: the
`"CLAUDE.md" if self.harness_type is HarnessType.CLAUDE else "AGENTS.md"` branch);
`interfaces.py:183-189` (`Environment.create_session` feeds it to `sandbox.add_files`);
`adapters/sandbox_agent.py:44-54` (`SandboxAgentSandbox.add_files` buffers into `self.files`);
grep confirms `SandboxAgentSandbox.files` is never read anywhere.

**What.** On every production run, the harness renders the instructions into a file map, the
environment writes it into the sandbox object, and the bytes go nowhere — the comment admits it:
"today AGENTS.md rides the wire, so this is informational" (`sandbox_agent.py:46-47`). The actual
delivery is the `agentsMd` wire field plus the runner's workspace materialization. Two problems:

1. **The port's only provisioning verb is decorative.** `Sandbox.add_files` is the one
   capability the `Sandbox` ABC adds over a bare handle, and no implemented backend honors it. A
   reader of `interfaces.py` reasonably concludes files flow through this seam; they do not.
2. **Harness knowledge leaked into the port layer.** The CLAUDE.md-vs-AGENTS.md decision is
   per-harness knowledge sitting in the abstract base — the exact smear pattern the runner review
   (A-4) fights on the TS side — and it duplicates the runner's `workspace.ts` logic, so the
   instructions-file rule now lives in three places (port base, runner workspace, and the Claude
   `claude-agent-sdk` loader behavior it mirrors).

**Concrete failure scenario.** Latent, not live: the first backend that honestly implements
`add_files` (the planned `LocalBackend`) will deliver the instructions TWICE — once via
provisioning, once via the `agentsMd` wire field its session presumably also sends — or a
contributor "fixes" `SandboxAgentSandbox` to forward `files` and Claude runs get a stray
`CLAUDE.md` fighting the runner's own materialization.

**Recommendation.** Pick one delivery channel and delete the other. Given the wire is the working
channel: remove `Harness._provisioning` and the `provisioning` parameter from
`Environment.create_session`, and drop the buffering from `SandboxAgentSandbox` (keep
`Sandbox.add_files` as an abstract no-op only if `LocalBackend` genuinely needs it, and then move
the filename choice onto the harness adapter as a declared `instructions_filename: ClassVar[str]`
— a table value, not a branch in the base class). Horizon: medium; pairs with the `LocalBackend`
work.

---

### A-5 (MEDIUM, short) — The two transports give the same timeout env var two different meanings, read at import time in two places

**Where:** `utils/ts_runner.py:16` (`_DEFAULT_TIMEOUT` — module import time),
`adapters/sandbox_agent.py:137` (constructor default — class-definition time, i.e. also import
time); semantics: `deliver_subprocess_stream` enforces a TOTAL deadline across the whole run
(`ts_runner.py:224-234`: `deadline = loop.time() + timeout`, decremented per read);
`deliver_http_stream` hands the float to `httpx.AsyncClient(timeout=timeout)`
(`ts_runner.py:178`), which is a PER-OPERATION timeout — for a stream, the max gap between
received chunks.

**What/why.** `AGENTA_RUNNER_TIMEOUT_SECONDS=180` means "the run must finish in 180s" under the
subprocess transport and "the runner must never go 180s without emitting a record" under HTTP.
Deployed (HTTP) and local-dev (subprocess) runs therefore have different failure behavior under
the same configuration, and neither is documented. Additionally both reads happen at import, so a
runtime env change or a test monkeypatch of one site does not affect the other (the constructor
default also evaluates once, a classic Python default-argument trap).

**Concrete failure scenario.** A healthy 5-minute agent run (long tool executions, steady event
flow) completes fine in production and ALWAYS dies at 180s for a developer on the subprocess
path — "works in prod, fails locally," debugged as a runner bug. Conversely a deployed run whose
runner keeps emitting heartbeat-ish events but is wedged never times out client-side at all,
compounding the runner review's no-deadline blocker (engine F1) — the Python side is the only
deadline the deployed system has, and on the HTTP path it is an idle timeout, not a deadline.

**Recommendation.** Define one timeout policy with two named numbers — `total` and `idle` — read
from env in ONE place at call time, threaded from `SandboxAgentBackend` into both transports, and
enforce both on both transports (an `asyncio.timeout` envelope for total; the read timeout /
per-read `wait_for` for idle). Keep 180 as the idle default; pick an explicit generous total
(coordinated with the runner-side deadline that runner F1 adds). Horizon: short — small diff, and
it is the client half of the runner's launch-gating deadline work.

---

### A-6 (MEDIUM, short) — Selector validation runs last: the vault is consulted before the harness value is even known to be valid, and the capability table is permissive for unknown harnesses

**Where:** `app.py:229-247` (tools, MCP, and the connection resolve all run first) vs
`app.py:276-278` (`make_harness` — where an invalid harness string finally raises);
`capabilities.py:209-212,221-224,234-236` (every `harness_allows_*` returns `True` when the
harness has no table entry, by design: "an unknown or newly-added harness is not broken by a
stale table").

**What/why.** Two composed issues:

1. **Ordering.** A run with a bogus `harness` value performs full server-side tool resolution,
   MCP resolution, and a vault round-trip (materializing a provider secret in memory) before
   failing on `HarnessType.coerce`. Cheap, pure validation should precede expensive, effectful
   resolution. Not a security hole (the secret never leaves the process), but it is wasted vault
   traffic and it widens the window where a doomed run holds a credential.
2. **The permissive-unknown default undermines the guard it belongs to.** The capability check is
   documented as THE server-side reject ("a direct API caller is checked too", `app.py:100-101`).
   But add `codex` to `HarnessType` and forget the `capabilities.py` entry, and every
   provider/mode/deployment combination is silently allowed for it — the table's failure mode is
   exactly the silent-drop class the codebase fights. The permissiveness is only safe for
   harness strings that will fail `make_harness` later; for known harnesses it is a trap.

**Concrete failure scenario.** A future `codex` harness lands in `HarnessType` and
`_HARNESSES` but not in `HARNESS_CONNECTION_CAPABILITIES`; a user picks a Bedrock-deployed
connection with it; the pre/post checks pass silently; the run reaches the runner and fails deep
in the harness with a provider auth error instead of the clean `UnsupportedDeploymentError` the
layer exists to produce.

**Recommendation.** (1) In `_agent` (or, post-A-1, in the composed handler): coerce
`HarnessType` and validate the harness/backend pair FIRST, before any resolution — `make_harness`
is side-effect-free and can be constructed before the resolves. (2) Keep the permissive default
for genuinely unknown strings if you must, but add an import-time assertion that every
`HarnessType` member has a capability-table entry
(`assert {h.value for h in HarnessType} <= set(HARNESS_CONNECTION_CAPABILITIES)`), which converts
the stale-table failure from silent-allow to loud-at-boot. Horizon: short (both are small).

---

### A-7 (MEDIUM, medium) — `dtos.py` imports upward into `adapters/` at runtime: the Claude settings rendering lives on the DTO

**Where:** `dtos.py:897-921` (`ClaudeAgentTemplate.wire_harness_files` lazy-imports
`adapters.claude_settings` inside the method; the comment at `dtos.py:908-910` documents the
import cycle it dodges).

**What/why.** The package's stated layering is dtos → interfaces/utils → adapters → handler
(`agents/__init__.py:3-10`), and it is otherwise real: `interfaces.py` imports only `dtos`,
`errors`, `streaming`; `streaming` imports `dtos` + `utils`; adapters import inward. This is the
one inversion: the lowest layer calls up into the adapter layer at runtime, hidden behind a lazy
import because the top-level import would be a hard cycle. The cycle is the symptom that the
Claude "adapter" is actually split across three homes: config mapping in
`adapters/harnesses.py:84-112`, wire fragments on the DTO subclass (`dtos.py:868-921`), and the
settings renderer in `adapters/claude_settings.py`. A contributor looking for "the Claude
adapter" must find all three.

**Recommendation.** Move the `harnessFiles` computation to adaptation time: have
`ClaudeHarness._to_harness_config` call `build_claude_settings_files(...)` (it already holds
every input) and carry the result as plain data on the template
(`harness_files: List[Dict[str, str]]`), with `wire_harness_files` reduced to serializing the
field. `dtos.py` drops the upward import; the adapter layer owns all Claude knowledge; the wire
output is byte-identical. Horizon: medium; mechanical, golden-pinned.

---

### A-8 (MEDIUM, medium) — The public API surface is one flat 120-symbol namespace that exports internals and misses one of its own guard functions

**Where:** `agents/__init__.py:23-271`; top-level re-exports in `agenta/__init__.py:60-66`.

**What/why.** Judged against the review's reference points (Grammel's small composable modules
with deliberate public surfaces; Hashimoto's "the entrypoint is the thinnest layer"):

- **Internals leak.** `coerce_tool_config`, `parse_tool_config`, `StaticConnectionResolver`,
  `EnvConnectionResolver`, `GatewayToolResolutionError`, `MissingSecretPolicy`, and a dozen more
  plumbing symbols sit at the same level as `AgentTemplate` and `PiHarness`. Nothing marks the
  supported surface vs the incidentally-public one, so every refactor of tool plumbing is a
  potential breaking change.
- **The surface is inconsistent with its own consumers.** `harness_allows_provider` and
  `harness_allows_mode` are exported (`__init__.py:252-253`) but `harness_allows_deployment` is
  not — the service imports it from the submodule (`app.py:33-37`). Either the trio is public or
  none of it is.
- **Import weight.** The package eagerly imports the Vercel egress adapter
  (`__init__.py:146-150`, kept as "former flat names (compatibility)"), so `import agenta` pulls
  the 675-line `stream.py` and friends into every process, including ones that never stream to a
  UI.
- **Name collisions inside one feature.** `AgentTemplate` exists twice: the SDK Pydantic model
  and the service's file-defaults dataclass (`services/oss/src/agent/config.py:29-37`) — `app.py`
  imports the SDK one while calling `load_config()` that returns the other, and maps between them
  field-by-field (`app.py:70-77`). `HarnessCapabilities` (probed, `dtos.py:154`) vs
  `HarnessConnectionCapabilities` (static table, `capabilities.py:121`) are one adjective apart.
  `services/oss/src/agent/secrets.py:17` re-exports the underscore-private `_PROVIDER_ENV_VARS`
  in `__all__`, kept alive only for one deprecated test (its own docstring says so).

**Recommendation.** Define the tiers deliberately: top level = the run-an-agent surface
(templates, messages, harnesses, backends, errors a caller can catch); `agents.tools` /
`agents.connections` / `agents.mcp` / `agents.skills` = the extension surfaces (resolver ABCs,
parse helpers); everything else private. Drop the flat Vercel re-export after one deprecation
release and make `adapters.vercel` import lazily (module `__getattr__`). Export
`harness_allows_deployment` alongside its siblings. Rename the service dataclass
(`FileAgentDefaults`). Delete `services/oss/src/agent/secrets.py` together with its deprecated
test. Horizon: medium (pre-GA of the SDK surface is the cheap moment; every release after locks
it in further).

---

### A-9 (MEDIUM, long) — Harness identity is five parallel tables; fold them toward one profile, mirroring runner A-4

**Where:** the per-harness facts live in: `HarnessType` (`dtos.py:43-59`), `HARNESS_IDENTITIES`
(`dtos.py:90-106`), `HARNESS_CONNECTION_CAPABILITIES` (`capabilities.py:145-167`), `_HARNESSES`
(`adapters/harnesses.py:149-153`), `SandboxAgentBackend.supported_harnesses`
(`sandbox_agent.py:126-128`), plus the per-harness template subclasses (`dtos.py:810-929`) and
the residual conditional in the port base (`interfaces.py:248`, finding A-4 here).

**What/why.** To add a `codex` harness on the Python side today you touch six declarative sites
in five files, all keyed by the same identity, with nothing but convention keeping them
consistent (see A-6's stale-table trap). This is a much better position than the runner (34
`isPi` branches); the tables exist, they are just scattered. The runner review's target is one
`HarnessProfile` record per harness (A-4); the Python side should converge on the same shape so
"add a harness" is one profile object per language.

**Recommendation.** Introduce a Python `HarnessProfile` (dataclass or model): `harness_type`,
`identity` (slug + display name), `template_cls`, `harness_cls`, `connection_capabilities`,
`instructions_filename`. One registry module owns the list; `HARNESS_IDENTITIES`,
`_HARNESSES`, `HARNESS_CONNECTION_CAPABILITIES`, and `supported_harnesses` become derived views
(keeping their import paths for compatibility). An import-time completeness check replaces the
permissive-unknown fallback for known types. Horizon: long, incremental — each derived view is
its own small PR; coordinate the shape with the runner's `HarnessProfile` so the two tables can
eventually share a generated source.

---

### A-10 (LOW, short) — Stale-path and stale-name drift, the Python mirror of runner A-19

**Where/what (all verified):** eight `services/agent/...` citations for a runner that lives at
`services/runner/` (`interfaces.py:239`, `dtos.py:212`, `utils/wire.py:4`, `skills/wire.py:5`,
`adapters/local.py:6`, `adapters/claude_settings.py:56-58`, `wire_models.py:5`);
`services/oss/src/agent/config.py:1` ("read from `services/agent/config`" — live-behavior half is
A-2); `config.py:19-20` cites `schemas.py` symbols (`_DEFAULT_MODEL` / `_DEFAULT_AGENTS_MD`) that
no longer exist; `interfaces.py:14` omits `AgentaHarness` from the adapter list; `app.py:200-201`
("``sandbox`` ... never enters ``SessionConfig``") contradicts `dtos.py:944-945` and the code.

**Why it matters less here than on the runner:** these are comment-level cites, not a README
teaching a false architecture. Why it still matters: every one of these files is exactly where a
new contributor (or an agent run against this repo) goes to find the runner, and the citations
send them to a directory that does not exist.

**Recommendation.** One sweep, same PR as A-2: `services/agent` → `services/runner`, fix the two
`config.py` comments, add `AgentaHarness` to `interfaces.py:14`, reword the `select_backend`
docstring ("no adapter consumes it" rather than "never enters SessionConfig"). Half an hour.
Horizon: short.

---

### A-11 (LOW, medium) — Lifecycle contract holes in the shared handler tail, latent until a stateful backend exists

**Where:** `handler.py:184-186` (`agent_event_stream`: `await harness.setup()` and
`run = await harness.stream(...)` both execute BEFORE the `try/finally` that owns
`harness.cleanup()`); `handler.py:224-227` (`agent_batch`: `setup()` outside the `try`);
`streaming.py:64-91` (`AgentStream.__aiter__` is a plain async generator: a second iteration
silently iterates an exhausted source instead of raising, despite "Iterate it once").

**What/why.** If `harness.stream()` — which awaits `create_session`, i.e. real work on a real
backend — raises in `agent_event_stream`, `harness.cleanup()` never runs, and the session created
inside `Harness.stream` (`interfaces.py:290-296`) is destroyed only via the `AgentStream` cleanup
hook, which never fires because the stream is never iterated. Today every step is a no-op or
in-memory on `SandboxAgentBackend`, so nothing leaks; the moment `LocalBackend` (or any backend
with `setup`/`create_sandbox` side effects) lands, this is the classic acquire-outside-try leak.

**Recommendation.** Move `setup()`/`stream()` inside the `try` whose `finally` calls `cleanup()`
in both functions (in `agent_event_stream`, wrap the whole body; the async-generator semantics
already defer execution to first iteration, so behavior is unchanged). Make `AgentStream` raise
on a second `__aiter__`. Horizon: medium; do it together with the `LocalBackend` work at the
latest.

---

### A-12 (LOW, medium) — The sandbox axis travels two parallel routes to the wire

**Where:** route one: `AgentTemplate.sandbox` → `select_backend` → `SandboxAgentBackend._sandbox`
(`app.py:203-207`, `sandbox_agent.py:139`) → `create_sandbox()` → `SandboxAgentSandbox.sandbox_id`
(`sandbox_agent.py:150-151`) → `request_to_wire(sandbox=...)` (`sandbox_agent.py:88-89`). Route
two: the same `AgentTemplate.sandbox` value rides, unread, inside `session_config.agent`
(`dtos.py:585,944-945`) and into `RuntimeAuthContext.backend` (`app.py:243-245`).

**What/why.** The value that reaches the wire takes a four-hop detour through the backend
constructor and a sandbox object whose only real job is carrying that string (plus the dead file
buffer, A-4). Meanwhile the copy in `SessionConfig.agent` is the one a reader finds first, and it
is documented as intentionally unread. Nothing is wrong today; it is simply two sources of truth
for one axis, and the day they disagree (a caller constructs `SandboxAgentBackend(sandbox="daytona")`
with a template that says `local`), the wire silently follows the backend and the config lies.

**Recommendation.** Fold this into the A-4 cleanup: if `SandboxAgentSandbox` loses its dead file
buffer, it is a plain value object and can honestly be named what it is (the run's sandbox
selector). Longer term, when the `SandboxBackend` port work lands runner-side (runner A-5),
revisit whether the Python `Sandbox` object earns its place or the axis should ride
`SessionConfig` explicitly. Horizon: medium/long; no behavior change needed now.

---

### A-13 (structural summary, long) — Verdict on the layering, and the target structure

**The responsibility split is real and mostly held.** "Python decides what, runner runs it" is
true in the code: all tool/MCP/secret/connection/skill resolution is server-side (`app.py:232-247`),
the per-harness translation happens in Python (`adapters/harnesses.py`, `claude_settings.py` via
`wire_harness_files`), and the runner receives resolved material. The leaks are small and named
above: harness knowledge in the port base (A-4), the dead provisioning channel (A-4), the dtos →
adapters inversion (A-7). The ports/adapters layering is **real, not decorative, with one
decorative member**: `Harness` is a genuine port (three adapters, construction-time validation,
per-harness mapping); `Backend` is genuine but has one real implementation plus a stub;
`Sandbox`/`Environment` are currently pass-through scaffolding on the production path (no-op
lifecycle, dead provisioning, `sandbox_per_session` policy that no deployed caller varies) —
future-facing weight being paid for today.

**Judged against the references.** Grammel: the registry/table pattern is half-adopted (good
tables, five of them — A-9); the public surface is one flat namespace instead of deliberate
modules (A-8). Hashimoto: the core-as-a-library idea is genuinely present — the SDK IS the
library and the service IS a thin entrypoint in intent — but the entrypoint re-implements the
library's top function instead of calling it (A-1), which is the one place the strict-layering
story actually breaks.

**Target structure** (same package; directories and ownership, no big bang):

```
agents/
  core/        dtos split: messages/events/results, template/config, fold, streaming
  harness/     HarnessProfile registry + per-harness adapters (harnesses.py,
               claude_settings.py, agenta_builtins.py, capabilities.py)
  backend/     interfaces (Backend/Sandbox/Session/Environment), sandbox_agent,
               local, _runner_config, ts_runner transports
  wire/        wire.py, wire_models.py, permission_rules, skills/wire
  platform/    (as today) resolution against the Agenta API
  handler.py   AgentComposition + make_agent_handler + agent_batch/agent_event_stream
  egress/      adapters/vercel (lazy-imported)
```

Dependency rule: `core` imports nothing internal; `wire` and `harness` import `core`; `backend`
imports `core` + `wire`; `handler` imports everything; the service imports `handler` and
composes. The A-7 fix (Claude files rendered at adaptation time) is what makes `core` a true
leaf.

**Migration order (each step independently shippable):**
1. **Pre-launch:** A-1 service adopts the composition seam (+ the request-aware `run_context`
   extension); A-2 fix the stale default paths; A-3 `/health` probe + `/stream` in
   `Backend.setup()`; A-5 one timeout policy (total + idle); A-6 validate selectors first +
   table-completeness assert; A-10 doc sweep.
2. **Month 1:** A-7 move Claude settings rendering out of `dtos.py`; A-4 delete the dead
   provisioning channel and the port-base filename branch; A-11 lifecycle try-scoping.
3. **Month 2+:** A-8 tier the public API and lazy-load the Vercel egress; A-9 `HarnessProfile`
   registry with derived views, coordinated with the runner's A-4 table; revisit
   `Sandbox`/`Environment` weight when `LocalBackend` lands (A-12).

---

## Reconciliation with the runner review

- **A-14 (duplicated orchestration): CONFIRMED and upgraded.** The runner review rated it medium;
  from the Python side it is HIGH, because the duplicate is not merely a maintenance burden — the
  SDK copy is the live seeded default for the same URI and already disagrees with the service in
  five enumerated behaviors (capability gating, degradation policy, MCP gating, `run_kind`,
  backend/template defaults). See finding A-1 for the fix that belongs here (adopt the seam;
  extend `run_context` to see the request).
- **A-7 (no version probe): CONFIRMED.** No `/health` call and the deprecated `/run` alias on
  both transports (`ts_runner.py:66,175`). The Python-side fix has a natural home the runner
  review could not see: `Backend.setup()` (finding A-3).
- **A-4/A-5 (harness/backend knowledge as tables/ports): PARTIALLY MIRRORED, better here.** The
  Python side already keys harness knowledge in tables (five of them — finding A-9) rather than
  34 scattered branches; the residual smears are the port-base filename branch and the dead
  provisioning channel (finding A-4). The backend axis IS a real port here (`Backend` ABC), so
  the runner's A-5 has no Python-side defect to mirror — only the two-route sandbox plumbing
  (finding A-12).
- **A-10 (runner fills the permission-mode policy default): REFUTED as a Python-side gap /
  CONFIRMED as already satisfied.** The SDK always sends an explicit `permissions.default` —
  `wire_permissions` unconditionally emits it (`dtos.py:713-719`) and `permission_default`
  defaults to `allow_reads` on both `AgentTemplate` (`dtos.py:586`) and `HarnessAgentTemplate`
  (`dtos.py:681`). The runner's fallback is therefore dead code for SDK-originated requests, as
  A-10's recommendation wanted; it remains reachable only for hand-built non-SDK requests.
- **A-19 (docs describe a removed architecture): CONFIRMED on this side in miniature** — eight
  stale `services/agent/` cites plus two stale comments, and one case where the stale path is
  live behavior, not prose (`config.py`, finding A-2).
- **A-1/A-2 (credential and API base smuggled through telemetry): out of my lane** (the producer
  is `tracing.py`, lane E), but the wire assembly I reviewed confirms the shape: the run's trace
  block is the only channel carrying the platform credential (`utils/wire.py:131-137`,
  `context`/`telemetry` from the single `trace` capture). Nothing in my scope contradicts the
  runner story.

---

## Top-10 priorities for this lane

1. **A-1** Service adopts `AgentComposition`/`make_agent_handler`; extend the seam with a
   request-aware `run_context`; delete the ~55-line duplicated body (short). The layering defect
   AND a live behavioral fork on a public URI.
2. **A-2** Fix `services/agent` → `services/runner` in `config.py`; decide the fate of the dead
   file-template mechanism; log the fallback (short).
3. **A-3** `/health` probe + protocol check in `SandboxAgentBackend.setup()`; move both
   transports to `/stream` (short). The client half of runner A-7.
4. **A-5** One timeout policy (total + idle) read once, enforced identically on both transports
   (short). The client half of the runner's no-deadline blocker.
5. **A-6** Validate harness/sandbox selectors before any resolution; import-time
   capability-table completeness assert (short).
6. **A-10** Stale-path doc sweep across the eight SDK files + `config.py` comments (short,
   fold into the A-2 PR).
7. **A-7** Move Claude settings rendering out of `dtos.py` into the Claude adapter; kill the
   upward lazy import (medium).
8. **A-4** Delete the dead provisioning channel; move the instructions-filename choice out of
   the port base onto the harness adapter as a declared value (medium).
9. **A-8** Tier the public API (supported surface vs internals), export
   `harness_allows_deployment` or none of the trio, lazy-load the Vercel egress, rename the
   colliding service `AgentTemplate` (medium).
10. **A-9** `HarnessProfile` registry with the five existing tables as derived views,
    shape-coordinated with the runner's A-4 profile (long, incremental).

**Counts:** 0 blocker · 3 high (A-1, A-2, A-3) · 6 medium (A-4, A-5, A-6, A-7, A-8, A-9) ·
3 low (A-10, A-11, A-12). A-13 is the structural summary, not counted.
