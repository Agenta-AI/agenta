# Python idioms and code quality — services/oss/src/agent + sdks/python/agenta/sdk/agents

Reviewer scope: native-Python quality across ALL of `services/oss/src/agent/` (611 lines, 9
files) and ALL of `sdks/python/agenta/sdk/agents/` (10,897 lines, 60 files), read at depth on
`dtos.py` (1232), `platform/op_catalog.py` (1105), `adapters/vercel/stream.py` (675),
`platform/connections.py` (543), `wire_models.py` (517), plus `handler.py`, `interfaces.py`,
`utils/ts_runner.py`, `utils/wire.py`, `streaming.py`, `fold.py`, all adapters, `platform/`,
`connections/`, `tools/`, `mcp/`, `skills/`, and the service composition. Architecture,
security, and the wire contract are other lanes' territory; where a finding brushes them it is
framed strictly as a code-quality issue. All counts below are grep- or tool-verified, not
estimated. Date: 2026-07-07. Baseline: branch `gitbutler/workspace`.

---

## How it actually works (verified against code)

The package is a real hexagonal layout and the imports mostly honor it. `interfaces.py`
defines the ports (`Backend`, `Sandbox`, `Session`, `Environment`, `Harness`) and imports only
`dtos`, `errors`, `streaming` (interfaces.py:24-35). The adapters import inward only —
`adapters/harnesses.py:26-40`, `adapters/sandbox_agent.py:20-39`, `adapters/vercel/stream.py:9-13`
— never sideways into `platform/` or each other. `platform/` (the connected, Agenta-backed
resolvers) imports `tools`, `connections`, `capabilities` — also inward. The one composition
root that legitimately imports everything is `handler.py`, which builds `agent_v0` from an
injectable `AgentComposition` dataclass (handler.py:79-98).

There is exactly one direction violation: `dtos.py:910` lazy-imports
`adapters.claude_settings` inside `ClaudeAgentTemplate.wire_harness_files`, with a comment
admitting the cycle it dodges. The root cause is that the three harness-specific config
classes (`PiAgentTemplate`, `ClaudeAgentTemplate`, `AgentaAgentTemplate`, dtos.py:810-930),
which carry per-harness wire rendering, live in the DTO module (finding 5).

One run flows: `_agent` parses `AgentTemplate.from_params` (a ~230-line hand-rolled dict walk,
dtos.py:1002-1232), resolves tools/MCP/connection via `platform/`, builds a `SessionConfig`,
picks a harness class from the `_HARNESSES` table (adapters/harnesses.py:149-153), and streams
one turn through `SandboxAgentBackend`, whose transports (`utils/ts_runner.py`) POST NDJSON to
the TS runner or spawn its CLI. `AgentStream` (streaming.py:39-99) turns the record stream
into live `Event`s plus one terminal `AgentResult`; `fold.py` folds the same events into the
batch shape; `adapters/vercel/stream.py` projects them into ai-sdk v6 frames for the
playground.

**Doc drift, verified:** the TS runner lives at `services/runner/`, but nine SDK docstrings
still cite `services/agent/src/protocol.ts` / `workspace.ts` (e.g. dtos.py:212,
utils/wire.py:4, interfaces.py in `_provisioning`), and — worse than prose — the service's
*code default* still points there: `services/oss/src/agent/config.py:15-16` sets
`_DEFAULT_AGENT_DIR = _SERVICES_DIR / "agent"`, a directory that no longer exists (finding 2).
`wire_models.py`'s docstring is accurate and candid (the models are a schema authority, "NOT a
runtime guard", wire_models.py:20-24), and `utils/wire.py:9-15` correctly describes the
deliberate hand-built-dict split. The dev-only surfaces (`Session.prompt`, the one-shot
transports, `agent_run_to_vercel_parts`) are all self-labeled "DEV-ONLY (unused)" in comments —
the labels are truthful, but the public API exports contradict them (finding 6).

## Strengths — keep this

This is idiomatic, modern Pydantic-v2 Python written by someone at home in the language. The
refactors should preserve these properties, several of which are *better* than the runner's
TypeScript equivalents:

1. **The tool models are exemplary Pydantic v2.** `tools/models.py` uses discriminated unions
   with `Annotated[Union[...], Field(discriminator=...)]` + `TypeAdapter` (models.py:246-257,
   411-415), `extra="forbid"` + `frozen=True` on specs, `AliasChoices` for dual-name
   acceptance, and `model_validator(mode="after")` invariants that encode real design rules
   (the `call` XOR `call_ref` check, models.py:379-397). `op_catalog.py`'s `PlatformOp` is a
   typed, frozen, import-time-validated catalog row (op_catalog.py:61-149) — the
   "validated table, not loose dicts" pattern the runner review *recommends* the TS side adopt.
2. **Secrets hygiene is disciplined in code, not just policy.** `ResolvedConnection.env` is
   the documented single secret channel, masked from `repr` (connections/models.py:178-180),
   `to_wire()` never emits it; `ToolCallback.authorization` is `repr=False`; log lines carry
   counts, never names or values (platform/secrets.py:13, 74).
3. **Near-zero type-system escape hatches.** Across 11.5k lines: **1** `# type: ignore`
   (connections/resolver.py:150), **0** `cast()`, **0** bare `except:`. mypy in default mode
   reports only 12 errors in 60 files (finding 7) — for a never-type-checked codebase that is
   remarkable and makes adopting a checker cheap.
4. **Broad excepts are deliberate and annotated.** All 19 `except Exception` sites carry
   either `# pylint: disable=broad-except` or a reason comment, and all but two log with
   `exc_info` before degrading. The degradation choices are documented policy (best-effort
   tracing, tolerant default-connection resolve, app.py:135-157), not laziness.
5. **Comments carry the why, cross-referenced to incidents.** F-017, F-040, F-046, the HITL
   name-drift saga (stream.py:137-143, 470-481) — same strength the runner review called out.
6. **Async discipline is fundamentally sound.** No blocking HTTP on async paths (httpx
   everywhere), subprocess streaming with deadline + kill-on-early-exit
   (ts_runner.py:227-258), `AgentStream.on_cleanup` runs on drain, break, and cancel.
7. **The capability table is the provider pattern the runner lacks.** `capabilities.py:145-167`
   is one `HARNESS_CONNECTION_CAPABILITIES` dict; adapters branch on capability flags, not
   harness names (dtos.py:154-158 states the rule). The Python side largely *is* the
   `HarnessProfile` design runner finding A-4 asks for.
8. **Small pure modules where it counts.** `fold.py` (pure, tested), `permission_rules.py`,
   `skills/models.py` with its path-traversal validation on the model itself
   (skills/models.py:22-46), `_runner_config.py` with actionable error messages.

## Offenders table (grep-verified)

`Any` = token count (mostly `Dict[str, Any]` wire bags — untyped-boundary pressure, not
sloppiness). Totals across both trees: ~380 `Any` tokens, 19 `except Exception`, 1
`type: ignore`, 0 `cast`, 0 bare `except:`.

| file | `Any` | `except Exception` | note |
|---|---:|---:|---|
| dtos.py | 82 | 0 | `from_raw(Any)` coercers + wire dicts; the parse helpers are all dict-walking |
| adapters/vercel/stream.py | 37 | 3 | `tool_names_by_id: Dict[Any, Any]`, bare `set` (stream.py:83-84) |
| tools/models.py | 20 | 0 | JSON-schema dicts — legitimate |
| platform/op_catalog.py | 20 | 0 | inline JSON-schema literals — legitimate |
| platform/connections.py | 19 | 1 | loose vault-record walking (`_as_dict` etc.) — untrusted input, acceptable |
| adapters/vercel/messages.py | 16 | 0 | UIMessage parts — untrusted boundary |
| utils/ts_runner.py | 11 | 1 | transport payload dicts |
| adapters/claude_settings.py | 11 | 1 | the one **silent** swallow (claude_settings.py:169) |
| handler.py | 9 | 2 | `agent_event_stream`/`agent_batch` params untyped (handler.py:181, 215) |
| fold.py | 9 | 0 | event dicts by design ("batch = fold(stream)") |

---

## Findings

### 1. The service re-implements the SDK's own composition seam (HIGH, short)

`services/oss/src/agent/app.py:210-287` (`_agent`) duplicates
`sdks/python/agenta/sdk/agents/handler.py:114-176` (`make_agent_handler`'s `_agent`) nearly
line by line: 33 of ~55 non-comment code lines are byte-identical (flags parse, template
parse, `to_messages`, tool/MCP resolve, model-ref/connection resolve, `SessionConfig`
assembly, `make_harness`, stream/batch dispatch). `_agent_model_ref` is copied verbatim
(app.py:80-92 = handler.py:101-106). This **confirms runner finding A-14 from the Python
side** and quantifies it.

The bitter part: `AgentComposition` (handler.py:79-98) already has an injection field for
*every* service-specific behavior — `default_template`, `resolve_tools`,
`resolve_mcp_servers`, `resolve_session_connection` (added *specifically* for the service's
capability gating, per its comment), `select_backend`, `trace_context`, `run_context`,
`record_usage`. The service imports `agent_batch`/`agent_event_stream` from the handler module
but not the seam around them. The only genuine gap is `run_kind`: app.py:249-253 folds
`request.meta["run_kind"]` into the run context, and `RunContextFn` takes no request.

**Failure scenario:** a fix lands in the SDK `_agent` (say, a new flag check or a changed
`SessionConfig` field default) and does not land in app.py; the playground path and the
standalone-SDK path silently diverge — exactly the drift class A-14 predicts, in the two
functions most likely to be edited before launch.

**Recommendation:** make the service build its handler with
`make_agent_handler(AgentComposition(default_template=_default_agent_template,
resolve_tools=resolve_tools, resolve_mcp_servers=resolve_mcp_servers,
resolve_session_connection=_resolve_session_connection, select_backend=select_backend))`,
and widen `RunContextFn` to accept the request (or add a `post_run_context(request, rc)`
hook) for `run_kind`. Delete the duplicated body from app.py. Horizon: **short** — the
mechanical part is under a day because the seam already fits.

### 2. Code defaults and docstrings still point at the removed `services/agent` (HIGH, short)

The runner was renamed to `services/runner/` (cli at `services/runner/src/cli.ts`, verified),
but:

- `services/oss/src/agent/config.py:15-16` — `_DEFAULT_AGENT_DIR = _SERVICES_DIR / "agent"`,
  which does not exist. Two consumers break differently:
  - `runner_dir()` (config.py:40-43): in a source checkout without
    `AGENTA_RUNNER_INTERNAL_URL`/`AGENTA_RUNNER_DIR`, `resolve_runner_command`
    (adapters/_runner_config.py:46-52) fails loud — but with an error naming a path that has
    never existed in this checkout, sending the developer hunting for a phantom directory.
  - `config_dir()` (config.py:52-55): `load_config` (config.py:58-78) checks `.exists()` and
    **silently** falls back to the hello-world template — an operator editing
    `services/agent/config/AGENTS.md` per the module docstring changes nothing, no warning.
- Nine SDK docstrings cite `services/agent/src/...` (grep `services/agent` = 9 hits, e.g.
  dtos.py:212, utils/wire.py:4). New contributors and agents grep for files that are not
  there.

This is the Python edge of runner Theme 9 (docs describing a removed system) — except here it
reached executable defaults. **Recommendation:** point both defaults at `services/runner`,
sweep the nine docstrings, and add a one-line startup log when `load_config` falls back to
defaults. Horizon: **short** (an hour).

### 3. `stream.py` is two hand-synced copies of a 160-line event loop, and the dead copy is the exported one (HIGH, medium)

`agent_run_to_vercel_parts` (stream.py:57-251) and `agent_stream_to_vercel_stream`
(stream.py:254-446) each contain the full event-type switch (message/thought lifecycle trios,
tool_call refresh logic, tool_result, interaction, data, file, usage, error, done). A diff of
the two loop bodies shows they differ in exactly two things: the event access idiom
(`event.type` vs `event.get("type")`) and the terminal-result handling. The hard-won HITL
comments ("Record the name only on first sight...", the `rawInput` preference) already exist
**twice, verbatim** (stream.py:130-143 = 333-346) — every fix in this file's history was
applied twice, and `fold.py:70-86` carries a third copy of the same refresh rule.

Meanwhile the copy marked "DEVELOPMENT-ONLY... not on any live request path" (stream.py:67-70)
is the one exported from the package root as `ui_message_stream` (`__init__.py:149`, alias at
stream.py:675), while the live `agent_stream_to_vercel_stream` — the function
`decorators/routing.py:363` actually calls — is not in `__all__` at all.

**Failure scenario:** the next HITL or frame-shape fix (this is the highest-churn file in the
package) lands in the live loop only; the dev loop drifts; someone debugging with the dev
surface sees different frames than production and burns a day on a phantom.

**Recommendation:** extract one `def _event_to_parts(etype, data, state) -> Iterator[part]`
(state = the seq counters, `seen_tool_calls`, `tool_names_by_id`) consumed by both drivers;
or, cheaper, delete `agent_run_to_vercel_parts` outright (it backs only a dev surface and a
back-compat alias with zero consumers — finding 6) and keep one loop. Export the live
function. Horizon: **medium** (do the export/delete part **short**).

### 4. `_PROVIDER_ENV_VARS` exists three times and has already diverged (MEDIUM, short)

Grep-verified: `platform/connections.py:41-51` (9 entries, includes
`"minimax": "MINIMAX_API_KEY"`), `platform/secrets.py:93-102` (8 entries, **no minimax**),
`connections/resolver.py:31-40` (8 entries, **no minimax**) — the last one carrying a comment
"Same shape and entries as `platform/secrets.py`'s" that is already false. Meanwhile
`capabilities.py:45-54` lists `minimax` as a Pi vault provider.

**Failure scenario:** a standalone-SDK user sets `MINIMAX_API_KEY` and runs a
`minimax/abab...` model; `EnvConnectionResolver.resolve` (connections/resolver.py:82) finds no
env var mapping and silently degrades to `runtime_provided` with no credential — the run fails
downstream with a misleading provider auth error, for a provider the capability table
advertises. Same hole in the deprecated `resolve_provider_keys` dump.

**Recommendation:** one table, one owner — put the provider→env-var map next to
`PI_VAULT_PROVIDERS` in `capabilities.py` (or `connections/models.py`) and import it in all
three sites; add a one-line test asserting every `PI_VAULT_PROVIDERS` entry has an env-var
mapping. Horizon: **short**.

### 5. `dtos.py` fuses five concerns, and the fusion is what forces the one layering violation (MEDIUM, medium)

The 1232-line module contains: (a) harness identity enums + the `HARNESS_IDENTITIES` table
(43-106); (b) capabilities + content blocks + messages + events (154-353); (c) trace/run
context models (357-514); (d) `AgentTemplate` plus ~230 lines of hand-rolled request parsing
(`_template`, `_section`, `_parse_agent_fields`, `_model_from_llm`... 1002-1232); (e) the
three harness config classes **with their wire rendering** (649-930). Concern (e) is adapter
logic: `ClaudeAgentTemplate.wire_harness_files` (dtos.py:897-921) must call the Claude
settings renderer, and because it lives in the DTO layer it can only do so via the lazy
`from .adapters.claude_settings import ...` at dtos.py:910 — the inner layer importing an
adapter, the single arrow pointing the wrong way in an otherwise clean graph. The same
fusion shows up as parse-quality: `_parse_run_selection` (dtos.py:1110-1130) silently maps an
invalid `permission_default` to `"allow_reads"` (mypy flags the assignment, dtos.py:1128)
where a Pydantic authoring model would reject or default it visibly.

**Recommendation:** split along the concerns that are already section-commented:
`dtos/messages.py` (blocks/messages/events/result), `dtos/context.py` (trace + run context),
`template.py` (`AgentTemplate` + the parse helpers, or better an authoring Pydantic model for
the `parameters.agent` shape so the dict-walking collapses into validators), and move the
`HarnessAgentTemplate` subclasses into `adapters/` where their `wire_*` knowledge belongs —
that move deletes the lazy import instead of documenting it. Keep `dtos.py` as a re-export
facade so no caller changes. Horizon: **medium** (mechanical but wide; do it before the file
grows past useful reviewability).

### 6. The public API exports the dead surfaces and hides the live one (MEDIUM, short)

Grep-verified consumer counts outside the package and its tests:

- `ui_message_stream` / `agent_run_to_vercel_parts` (`__init__.py:149`, stream.py:675): **0**
  consumers; self-documented dev-only.
- `from_ui_messages` / `to_ui_message` (`__init__.py:147-148`, messages.py:289-290,
  "former flat module API" aliases): **0** consumers.
- `deliver_http_result` / `deliver_subprocess_result` + `Session.prompt` one-shot path
  (ts_runner.py:57-149, sandbox_agent.py:103-115): marked "DEV-ONLY (unused)... Do not wire
  them back in", yet `prompt` is an *abstract required method* on the `Session` port
  (interfaces.py:69-75) — every future backend must implement a method the runtime never
  calls.
- The live `agent_stream_to_vercel_stream` (used by `decorators/routing.py:363`): **not
  exported**.
- `EnvConnectionResolver` / `StaticConnectionResolver`: designed standalone-SDK API, currently
  test-only — fine to keep, but mark them as the supported offline path.

This package is pre-launch with no external consumers; the back-compat aliases protect
nobody. **Recommendation:** delete the four dead aliases, export
`agent_stream_to_vercel_stream`, demote `Session.prompt` to a non-abstract convenience
implemented once over `stream()` (drain + fold), and move the one-shot transports behind a
`_dev` name or delete them. Horizon: **short**.

### 7. Tooling is format-only; the measured ratchet is unusually cheap (MEDIUM, short)

Config as it stands: `ruff.toml` at the repo root is two lines (`exclude = ["clients/"]`), so
ruff runs with **default rules only** (E4/E7/E9/F — pyflakes plus a sliver of pycodestyle).
No mypy or pyright config exists anywhere in the repo. CI (`11-check-code-styling.yml`) runs
`ruff format --check` and `ruff check` only. So the strengths in this codebase are habits,
not guarantees.

Measured on exactly these two trees (ruff 0.15.x, mypy current):

| tool / flag | errors | assessment |
|---|---:|---|
| `mypy` (default, `--ignore-missing-imports`) | **12** in 60 files | 4 are real code smells: the `part` variable redefinition (stream.py:198,201/401,404), wrong return annotations in `tools/resolver.py:60,74`, `set[str \| None]` leak (platform/connections.py:214) |
| `mypy --disallow-untyped-defs` | 22 | the 10 extra are `handler.py`'s untyped publics and friends |
| `mypy --strict` | 69 | still a one-week ratchet, not a rewrite |
| ruff `B` (bugbear) | 2 | `Sandbox(ABC)` with no abstract method (interfaces.py:43) — real: `Sandbox()` is instantiable |
| ruff `SIM`, `RET`, `ARG`, `PTH` | 3+5+2+1 | trivia |
| ruff `RUF` | 16 | unsorted `__all__` etc. |
| ruff `TRY` | 56 | mostly TRY003 message-style noise; skip the family |
| ruff `UP` (pyupgrade) | **905** (849 autofixable) | the whole package writes `Dict`/`List`/`Optional` on a `requires-python >= 3.11` package; some files already use `dict[str, Any]`/`list[str]` (claude_settings.py:70, tools/compat.py:32), so the style is split mid-package |

**Recommendation (the concrete ratchet):** (1) one autofix commit: `ruff check --select
UP,RUF,RET,SIM,C4 --fix` scoped to these trees, plus a per-package `extend-select = ["B",
"C4", "SIM", "RET", "UP", "RUF", "PTH", "ARG"]` in a `sdks/python/ruff.toml` section so the
repo-wide config stays untouched; (2) add mypy (default mode) over `agenta/sdk/agents` +
`services/oss/src/agent` to the styling workflow now — the cost is fixing 12 errors; (3)
schedule `disallow-untyped-defs` for these packages within a month (22 errors); treat
`--strict` as the long-term target. Skip `ANN` and `TRY` in ruff; mypy supersedes the former
and the latter is noise. Horizon: **short** for (1)-(2).

### 8. The SDK never validates what comes back over the wire, and the models to do it already exist (MEDIUM, short)

`wire_models.py` states its own limitation honestly: "They are NOT a runtime guard...nothing
validates against these models on a live `/run`" (wire_models.py:20-24). Concretely,
`result_from_wire` (utils/wire.py:158-192) dict-walks the terminal record with `.get()` and
default-coercions, `AgentStream.__aiter__` passes `record.get("result") or {}`
(streaming.py:75), and every NDJSON line is `json.loads(line)` with no shape check
(ts_runner.py:191, 239). This is the Python mirror of runner Theme 8 / idioms finding 1
("the boundaries trust their input" — there the `/run` body, here the `/run` result). The
producer side is well-pinned by goldens; the consumer side compensates with the `Any`-bag
style that dominates the offenders table.

**Failure scenario:** a runner version skew (runner review A-7: no `/health` probe) ships an
event or result field with a changed type; the Python side does not reject it at the boundary
— it flows as `Any` into `fold`/`stream.py` and surfaces as a wrong playground frame or a
mid-stream `KeyError` with no indication the contract broke.

**Recommendation:** validate the terminal result record with
`WireRunResult.model_validate(...)` inside `result_from_wire` (the model is `extra="allow"`,
so it cannot reject forward-compatible fields — it only catches type breakage), and wrap the
per-line `json.loads` in the transports to raise the existing `_transport_error` with the
offending line logged. Both are additive and golden-safe. Horizon: **short**. This also
strengthens the lane-B case for A-9 (schema-first): today the schema models are pure overhead
at runtime; making them the runtime guard earns their keep.

### 9. Env-read discipline: sixteen scattered `getenv` sites, two frozen at import, one knob with two owners (MEDIUM, short)

Grep-verified 16 `os.getenv`/`os.environ` sites across the two trees. Three concrete
problems:

- `AGENTA_RUNNER_TIMEOUT_SECONDS` is read **twice**: at module import
  (ts_runner.py:16, `_DEFAULT_TIMEOUT`) and again inside a **default argument** evaluated at
  class-definition time (sandbox_agent.py:137) — two owners, both frozen before any test or
  runtime override can act. The same module then documents the opposite policy for the
  token: `_runner_auth_headers` is "Read per-call (not cached) so a test or runtime env
  change takes effect" (ts_runner.py:29-30). One file, two contradictory conventions.
- `_CAPTURE_CONTENT` (tracing.py:32-38) freezes at import; flipping
  `AGENTA_AGENT_CONTENT_CAPTURE_ENABLED` needs a process restart while the neighboring flags
  are live-read.
- The repo convention (root AGENTS.md: env through a shared `env` object, never raw
  `os.getenv`) covers `api/`; the SDK/service agent code has no equivalent, which is exactly
  how the runner ended up with 45 scattered `process.env` reads (runner idioms finding 4).

**No process-global mutation exists** — grep for `os.environ[` writes returns nothing — so
the runner's A-2 bug class is refuted on the Python side.

**Recommendation:** one `agents/_env.py` (or extend `platform/connection.py`'s role) with
per-call accessor functions (`runner_timeout()`, `runner_token()`, `capture_content()`,
`mcps_enabled()`...); replace the default-arg read in `SandboxAgentBackend.__init__` with
`timeout: Optional[float] = None` resolved in the body. Horizon: **short**.

### 10. No shared exception base: transport and run failures are bare `RuntimeError` (MEDIUM, medium)

The subsystems each have a well-shaped typed hierarchy (`connections/errors.py`,
`tools/errors.py`, `mcp/errors.py`, `skills/errors.py` — keyword-carrying, message-building,
a genuine strength). But the runtime spine raises anonymous `RuntimeError` at every boundary:
transport failures (ts_runner.py:44, 132, 196, 231), run failure (`result_from_wire`,
utils/wire.py:166-168), truncated stream and early `result()` (streaming.py:83, 96), and
`UnsupportedHarnessError`/`AgentRunnerConfigurationError` subclass `RuntimeError` directly
with no common agent base. A caller (the service normalizer, a test, a retry wrapper) cannot
distinguish "the run failed with a user-actionable provider message" from "the transport
died" from "a bug" except by string-matching messages — the same
exceptions-as-strings weakness the runner review flagged as its finding 16 (zero `Error`
subclasses, regex on messages).

**Recommendation:** add `class AgentRuntimeError(RuntimeError)` in `errors.py` and two
subclasses, `RunnerTransportError` (raised by `_transport_error` and the truncated-stream
paths) and `AgentRunFailedError` (raised by `result_from_wire`, carrying the sanitized
message and, optionally later, a structured code when the wire grows one). Keeping
`RuntimeError` as the base preserves every existing `except RuntimeError`. Horizon:
**medium**; the class definitions plus the five raise sites are a half-day.

### 11. Async nits on the transport path (LOW→MEDIUM, short)

All in `utils/ts_runner.py`, all small, all on the production streaming path:

- `asyncio.get_event_loop()` (ts_runner.py:224) is deprecated inside coroutines since 3.10;
  use `asyncio.get_running_loop()`. One-line.
- `proc.stdin.write(...)` + `close()` with no `await proc.stdin.drain()`
  (ts_runner.py:222-223): no backpressure — the entire request payload (which now carries
  inline skills and can be large) buffers in memory before the pipe flushes. Add
  `await proc.stdin.drain()` before `close()`.
- The httpx `timeout=timeout` on the streaming client (ts_runner.py:178) is a *per-read*
  timeout, not the overall deadline the name suggests; a HITL pause quieter than 180s
  between records kills the stream with a `ReadTimeout` while the subprocess twin implements
  a true overall deadline (ts_runner.py:225-234). The two transports disagree on what
  "timeout" means. Decide one semantic (probably: generous read timeout + overall deadline)
  and apply it to both.
- Sync file IO inside the async request path: `load_config()` reads two files per request
  (config.py:58-78 via `_default_agent_template`, called from async `_agent`), and
  `resolve_runner_command` stats the CLI path per run (_runner_config.py:47). Both are tiny
  and local — acceptable — but cache `load_config` with an mtime check rather than moving it
  to a thread.

### 12. `AgentStream.__aiter__` is an async-generator method, so "iterate once" is unenforced (LOW, short)

`__aiter__` is declared `async def` with `yield` (streaming.py:64), so every `async for`
constructs a *fresh* generator over the same `self._records`. A second iteration silently
re-drains the exhausted source, raises the misleading "stream ended without a terminal
result record" (streaming.py:83), and runs every cleanup hook a second time
(`session.destroy()` is a no-op twice today, but the contract doesn't say hooks must be
idempotent). **Recommendation:** guard with a `self._consumed` flag raising a clear
"AgentStream can only be iterated once", or build the generator in `__init__` and have
`__aiter__` return it. Horizon: **short** (ten lines including the test).

### 13. Typing gaps concentrated in the two files that need types most (LOW→MEDIUM, short)

- `handler.py:181, 215`: `agent_event_stream(harness, session_config, msgs, ...)` and
  `agent_batch(...)` — the two functions the *service* imports across the package boundary —
  have untyped parameters and (for the stream) no return annotation. These are the seam of
  finding 1; type them first (`harness: Harness`, `session_config: SessionConfig`,
  `msgs: Sequence[Message]`, `-> AsyncIterator[Dict[str, Any]]`).
- `stream.py:83-84, 286-287`: `seen_tool_calls: set` (bare) and
  `tool_names_by_id: Dict[Any, Any]` — the HITL resume key lives in these two structures;
  they should be `set[str]` / `dict[str, str]` (or `Optional[str]` values) so a type checker
  can see a key-type drift, which was the actual root cause of the resume-loop bug the
  comments describe.
- `stream.py:198/201` and `401/404`: `part` redefined with a different shape in the same
  scope (mypy no-redef) — rename the second to `data_part`.
- `Event.type: str` + `data: Dict[str, Any]` (dtos.py:331-345) is deliberately open (the
  docstring says so) — fine — but a `Literal`-typed `KNOWN_EVENT_TYPES` frozenset constant
  would at least centralize the vocabulary that `fold.py`, `stream.py` (twice), and
  `handler.py` each restate by hand today.

### 14. Four mirrors of the wire shape live in this package alone (MEDIUM, long — supports runner A-9)

For one wire field the Python side hand-maintains: (a) the snake_case DTO field, (b) its
`to_wire()`/`from_wire()`/`from_raw()` hand-mapping (16 such methods, grep-verified), (c) the
`Wire*` schema model with the camelCase alias, and (d) the golden fixture — plus
`protocol.ts` across the language boundary. The duplication is visible in pairs like
`HarnessCapabilities.from_wire` (dtos.py:173-192), which hand-parses eleven
`data.get("camelCase", default)` fields, next to `WireHarnessCapabilities`
(wire_models.py:346-359), which models the same eleven fields with aliases and could do that
parse as `WireHarnessCapabilities.model_validate(data)` + one dump. Same for
`ContentBlock.to_wire/from_raw` vs `WireContentBlock`. The split is *documented* as
deliberate (utils/wire.py:9-15: omit-when-empty lives in the hand dict, pinned by goldens),
and the discipline holds today — but it is a per-field tax of four hand-synced edits, and it
is exactly the "complexity ceiling" runner A-9 names. **Recommendation:** short-term, use
the existing wire models for the *parse* direction (finding 8) where omit-when-empty doesn't
apply; long-term, one schema-first source generating both the TS types and the Python wire
models, leaving only the DTO↔wire projection hand-written. Horizon: **long** (echoing A-9's
placement).

### 15. Harness knowledge is table-driven but the tables are scattered; one branch leaks into the port base (LOW, medium)

Adding a harness today touches four Python tables plus the wire: `HarnessType` +
`HARNESS_IDENTITIES` (dtos.py:43-106), `_HARNESSES` (adapters/harnesses.py:149-153),
`HARNESS_CONNECTION_CAPABILITIES` (capabilities.py:145-167), and each backend's
`supported_harnesses` frozenset (adapters/sandbox_agent.py:126-128). That is far better than
the runner's 34 `isPi` branches (runner A-4 / Theme 6 — the Python side substantially
*refutes* the theme for itself), but it is still four places with no cross-check. One true
scattered branch exists: `Harness._provisioning` picks `"CLAUDE.md" if self.harness_type is
HarnessType.CLAUDE else "AGENTS.md"` **in the port base class** (interfaces.py:248) — per the
package's own rule ("adapters branch on flags, not the harness name", dtos.py:154-158) this
belongs on the adapter, e.g. a `instructions_filename: ClassVar[str] = "AGENTS.md"`
overridden by `ClaudeHarness`. **Recommendation:** fold the identity/class/capabilities rows
into one `HarnessProfile` record (the Python twin of the runner's recommended table) when the
runner does its A-4 work, and move the filename branch now. Horizon: **medium**.

### 16. Assorted convention breaks (LOW, short)

- `adapters/sandbox_agent.py:41` uses `logging.getLogger(__name__)`; every other module uses
  `get_module_logger` (structlog). One import swap.
- `PERMISSION_MODES` names two different vocabularies: the runner permission modes
  (dtos.py:109, `{"allow","ask","deny","allow_reads"}`) and Claude's `defaultMode` set
  (claude_settings.py:47 aliasing `CLAUDE_PERMISSION_MODES`). Same name, different members —
  an autocomplete/import trap. Rename one (e.g. `RUNNER_PERMISSION_MODES`).
- The `PermissionMode` Literal is defined twice (tools/models.py:31 and utils/wire.py:39) —
  import it in `wire.py` instead.
- `_agent_element` (dtos.py:1051-1053) is a do-nothing alias of `_template`; delete it.
- `claude_settings.py:169`: `except Exception: continue` drops a malformed tool spec with no
  log — the only fully silent swallow found; add a `log.warning` (a dropped spec here means a
  tool that should have had a permission rule silently falls to the default gate).
- `Sandbox(ABC)` has no abstract members (interfaces.py:43, ruff B024) — either mark
  `destroy` abstract or drop the ABC and document it as a default-no-op base.
- `__all__` unsorted and the `Tuple` import style predates 3.9 (`tuple[...]` already used
  elsewhere, e.g. tracing.py:117) — covered by the finding-7 autofix.

### 17. Every platform call constructs a fresh `httpx.AsyncClient` (MEDIUM, short)

Each adapter opens and closes its own client per call: connection resolve
(platform/connections.py:506), gateway tool resolve (platform/gateway.py, the
`async with httpx.AsyncClient(...)` in `resolve`), named-secret resolve and provider-key dump
(platform/secrets.py:44-49, 137-140), and the HTTP transports (utils/ts_runner.py:67, 178).
One `/invoke` with tools, MCP secrets, and a structured model performs up to four separate
TCP+TLS handshakes to the *same* Agenta API base before the run even starts, then a fifth to
the runner. No correctness bug — but it is measurable per-run latency and socket churn in the
service under load, and it is the Python cousin of the runner's exporter-cache/connection
hygiene findings (runner idioms 3). **Recommendation:** hang one shared `httpx.AsyncClient`
off `PlatformConnection` (created lazily, closed on app shutdown; headers stay per-call so
credentials never stick to the client), and let the transports accept an optional client.
Horizon: **short**.

---

## Reconciliation with the runner review

- **A-14 (duplicated orchestration): confirmed and quantified** — 33/55 identical lines,
  seam already exists, one `run_kind` gap (finding 1).
- **Theme 9 (stale docs): confirmed and extended** — on the Python side the stale
  `services/agent` path is executable default config, not just prose (finding 2).
- **Theme 8 / idioms-1 (boundaries trust input): confirmed as a mirror** — the runner casts
  the `/run` body; the SDK dict-walks the `/run` result. Both have the validation artifact
  already written and unused at runtime (finding 8).
- **Theme 6 / A-4 (booleans not seams): largely refuted for Python** — harness knowledge here
  is tables and adapter classes; the residue is four scattered tables and one branch in the
  port base (finding 15).
- **A-2 (request-driven `process.env` mutation): refuted for Python** — no `os.environ`
  writes exist (finding 9).
- **A-1/A-2 (credential and API base through telemetry): confirmed as originating here** —
  `platform/connection.py:53-67` derives the API base by slicing the OTLP URL and
  `_derive_authorization` (connection.py:76-99) reuses the tracing propagation's
  `Authorization`; `TraceContext.telemetry_to_wire` (dtos.py:391-403) nests the credential in
  exporter headers. Lanes B/E own the fix; from the idioms angle it is config derived from a
  telemetry string, the pattern to unwind with the first-class `platform` block.
- **Runner idioms 3 (exporter cache keyed on ephemeral credential): no Python equivalent**,
  but the per-call `httpx.AsyncClient` churn (finding 17) is the closest cousin: connection
  reuse is zero by construction.
- **Runner idioms 16 (zero Error subclasses): partially mirrored** — Python has rich
  subsystem hierarchies but a bare-`RuntimeError` spine (finding 10).

## Top 10 priorities for this lane (payoff per effort)

1. **Fix the `services/agent` stale defaults + nine docstrings** (finding 2) — an hour;
   removes a silent config fallback and a phantom-path error. *short*
2. **Point the service at `make_agent_handler(AgentComposition(...))` and delete the
   duplicated `_agent`** (finding 1) — the seam exists; this closes the A-14 drift channel
   before launch traffic. *short*
3. **Adopt mypy default mode in CI for these two trees** (finding 7) — 12 fixes buys a
   permanent guard; 4 of the 12 are real. *short*
4. **One `ruff --fix` commit + per-package `extend-select`** (finding 7) — 849 autofixes,
   ends the `Dict`-vs-`dict` style split. *short*
5. **Unify `_PROVIDER_ENV_VARS` into one imported table + coverage test** (finding 4) — kills
   an already-live divergence (minimax). *short*
6. **Collapse `stream.py`'s twin loops to one shared generator; export the live function,
   delete the dead dev surface and back-compat aliases** (findings 3, 6). *short→medium*
7. **Validate the terminal wire result with the existing `WireRunResult`; guard NDJSON
   parsing** (finding 8) — makes the schema models a runtime guard, mirrors the runner's zod
   move. *short*
8. **One env accessor module; fix the double-read frozen timeout** (finding 9). *short*
9. **Type the `handler.py` seam functions and the `stream.py` HITL state; fix the `part`
   redefinitions** (finding 13). *short*
10. **Split `dtos.py` and move the harness config classes into `adapters/`** (finding 5) —
    dissolves the one layering violation and makes the biggest file reviewable again.
    *medium*

Below the line but recorded: the shared-httpx-client change (finding 17), the
`AgentRuntimeError` hierarchy (finding 10), the `AgentStream` iterate-once guard (finding
12), the HarnessProfile consolidation (finding 15), and schema-first generation (finding 14,
long, jointly with the runner's A-9).
