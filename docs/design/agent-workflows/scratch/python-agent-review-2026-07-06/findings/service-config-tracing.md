# Lane E — Service config, schemas, tracing

## 1. Scope

Read in full: `services/oss/src/agent/config.py` (78 lines), `services/oss/src/agent/schemas.py`
(80 lines), the config-parsing parts of `services/oss/src/agent/app.py` (328 lines, all read),
and `sdks/python/agenta/sdk/agents/tracing.py` (235 lines). To trace the credential and the
policy-default questions to their actual answer, I also read the adjacent producer/consumer code
the brief pointed at: `sdks/python/agenta/sdk/agents/dtos.py` (`TraceContext`, `AgentTemplate`,
`HarnessAgentTemplate` — lines 357-403, 543-681, 715), `sdks/python/agenta/sdk/utils/types.py`
(`build_agent_v0_default` and its default constants, lines 1059-1090, 1412-1457),
`sdks/python/agenta/sdk/engines/tracing/propagation.py` (`inject`/`extract`), and the existing
tests at `services/oss/tests/pytest/unit/agent/test_default_agent_template.py`,
`test_select_backend.py`, and `sdks/python/oss/tests/pytest/unit/agents/test_tracing.py`. I also
read the runner review's executive summary and findings A-1, A-2, and A-10 in
`docs/design/agent-workflows/scratch/runner-review-2026-07-05/findings/arch-boundaries.md` for
reconciliation.

## 2. How it actually works — verified against code

**Config loading (`config.py`).** `load_config()` (config.py:58-78) reads two optional files from
`config_dir()` (default `services/agent/config/`, overridable via `AGENTA_AGENT_TEMPLATE_DIR`,
config.py:52-55): a plain-text `AGENTS.md` and a JSON `agent.json` (`model`, `tools`). Both are
optional; missing files fall back to the module-level constants `DEFAULT_MODEL` ("gpt-5.5") and
`DEFAULT_AGENTS_MD` (config.py:21-26). The result is a local dataclass also named `AgentTemplate`
(config.py:29-37) — not the same class as the SDK's `agenta.sdk.agents.dtos.AgentTemplate`. `app.py`
calls `load_config()` inside `_default_agent_template()` (app.py:70-77) and re-projects the three
fields into the SDK's `AgentTemplate` (`instructions=file_cfg.agents_md, model=..., tools=...`),
which then becomes the `defaults=` argument to `AgentTemplate.from_params(params, defaults=...)`
(app.py:225-227, `dtos.py:609-641`) — the request's `parameters.agent` wins field-by-field, and
whatever it does not set falls back to this file-based default. `runner_dir()`/`runner_url()`
(config.py:40-49) are separate accessors read fresh by `select_backend()` (app.py:195-207) to pick
the HTTP-vs-subprocess transport; they are not part of the agent template at all.

**Schemas (`schemas.py`).** `AGENT_SCHEMAS` (schemas.py:76-80) is the `/inspect` advertisement: three
permissive JSON Schemas (`inputs`, `parameters`, `outputs`), all `additionalProperties: True` with
no `required`. They exist purely to tell the playground how to render the agent (chat box in,
chat box out, one `agent-template` control at `parameters.agent`) — nothing in this codebase
validates an incoming request against them (no `jsonschema.validate` call was found anywhere in
`services/oss/src/agent/` or the SDK's running engine). Real request-shape enforcement happens
later, in `WorkflowInvokeRequestFlags(**...)` (app.py:217) and in `AgentTemplate`'s Pydantic
validators (`dtos.py`). The one interesting piece is `_DEFAULT_AGENT_TEMPLATE = build_agent_v0_default()`
(schemas.py:41, no arguments): the published `/inspect` default is built by a single shared
function in `sdks/python/agenta/sdk/utils/types.py:1412-1457`, called with `skill_slug=None,
include_sandbox_permission=False`. `test_default_agent_template.py` locks this: the SDK builtin
interface and the service's `/inspect` default must both equal the bare builder output, and that
output must parse cleanly through `AgentTemplate.from_params`. This is real single-source-of-truth
discipline (see Strengths).

That default embeds `_DEFAULT_SANDBOX = "local"` (types.py:1071) as `template["sandbox"] = {"kind":
"local"}` (types.py:1445-1456). Nothing in `schemas.py`, `config.py`, or `app.py`'s
`select_backend()` (app.py:195-207) overrides or gates this per environment; `select_backend` reads
whatever `agent_template.sandbox` carries and threads it straight into `SandboxAgentBackend`
verbatim.

**Tracing (`tracing.py`).** Two independent capture functions run once per turn from `app.py:249-260`
inside `_agent()`: `run_context()` (tracing.py:183-209) and `trace_context()` (tracing.py:41-76).
`run_context()` captures the run's own trace ids and workflow/application/evaluator identity from
ambient OTel/`TracingContext` state, with the two sub-captures (`_run_context_workflow`,
`_run_context_trace`) wrapped in independent `try/except` blocks so a failure in one cannot drop
the other — this exact contract is unit-tested (`test_tracing.py:16-57`). `trace_context()` is the
one this lane was asked to trace precisely: it calls `inject({})` (tracing.py:53, from
`agenta.sdk.engines.tracing.propagation`), which stamps `traceparent`, `baggage`, and — at
`propagation.py:93-94` — `headers["Authorization"] = ctx.credentials` from the active
`TracingContext`. Back in `tracing.py`, that header is read at line 71
(`authorization=headers.get("Authorization")`) and the OTLP endpoint is read at line 63
(`ag.tracing.otlp_url`); both are packed into a `TraceContext` (`dtos.py:357-403`) alongside
`capture_content`. `TraceContext.telemetry_to_wire()` (dtos.py:391-403) is where the credential
actually lands in the wire shape the runner reads: `exporters.otlp.headers.authorization`. The
docstring on `TraceContext` (dtos.py:357-373) is admirably explicit that this is deliberate design,
not an accident: "the CREDENTIAL nested under the exporter's `headers` rather than as a
free-floating field." `record_usage()` (tracing.py:212-235) is unrelated to the credential path: it
stamps `gen_ai.usage.*` attributes onto the active `/invoke` span so the workflow's token/cost totals
show up even though the harness's own span tree exports separately.

**Doc drift found.** `config.py`'s comment (lines 19-20) says its defaults are "Kept in sync with
the catalog template and the `/inspect` schema defaults (schemas.py: `_DEFAULT_MODEL` /
`_DEFAULT_AGENTS_MD`)" — but `schemas.py` defines no such names; it imports `build_agent_v0_default`
from `types.py`, which defines its own separately-named `_DEFAULT_AGENT_MODEL` /
`_DEFAULT_AGENTS_MD` (types.py:1059-1064). The comment points at names that do not exist in the file
it names. Separately, `build_agent_v0_default`'s docstring (types.py:1423-1425) says "the service
passes the reserved platform default skill; the SDK builtin passes none" — but no call site anywhere
in the repo passes `skill_slug` (verified by grep across `sdks/` and `services/`); `schemas.py:41`
calls it bare, and `test_default_agent_template.py:62-76` explicitly asserts the published default
carries no skill. The docstring describes a build-kit feature that either never shipped here or
lives entirely outside this call path.

## 3. Strengths — keep this

- **One real source of truth for the published default.** `build_agent_v0_default()`
  (types.py:1412-1457) collapsed what the file's own comment says used to be three
  hand-maintained copies (SDK builtin, `/inspect` schema, catalog field defaults) into one builder,
  and `test_default_agent_template.py` locks both consumers to it and checks it round-trips through
  `AgentTemplate.from_params`. This is exactly the kind of drift-proofing the rest of the codebase
  should copy for its own duplicated literals (see Finding 2).
- **Independent-failure-domain tracing capture.** `run_context()` (tracing.py:183-209) treats the
  workflow-identity capture and the trace-identity capture as two failure domains on purpose, and a
  unit test pins the contract in both directions (`test_tracing.py:16-57`). Nothing in this module
  can turn a telemetry hiccup into a broken run: every capture path is best-effort and degrades to
  `None`.
- **Honest docstrings.** `TraceContext` (dtos.py:357-403) and `trace_context()` (tracing.py:41-76)
  say plainly that the credential rides the telemetry exporter headers on purpose, and why. That is
  rarer and more valuable than it sounds — it is what let this review confirm the design instead of
  guessing at it.
- **Small, single-purpose env accessors.** `runner_dir()` / `runner_url()` / `config_dir()`
  (config.py:40-55) are narrow, documented, one-line functions, each with direct test coverage
  (`test_select_backend.py`). This is a reasonable, already-working pattern for the handful of env
  vars this file owns.
- **Config-parsing in `app.py` fails loud where it counts.** The pre/post-resolve harness capability
  checks (app.py:95-129) and the named-vs-default connection split (app.py:131-192) are carefully
  reasoned: a misconfiguration is rejected, a missing-credential default degrades gracefully. That
  asymmetry is exactly right and is documented in the code, not just in a design doc.

## 4. Findings

### Finding 1 (HIGH, short→medium) — A-1 confirmed: the credential and API base are packed into the OTLP exporter headers by design, with no first-class field

**Where:** `tracing.py:41-76` (`trace_context()`, especially lines 53, 63, 71),
`sdks/python/agenta/sdk/engines/tracing/propagation.py:93-94` (`inject`, one hop upstream),
`dtos.py:357-403` (`TraceContext`, `telemetry_to_wire()`).

**What and why:** This is the producer side of runner finding A-1. `trace_context()` reads the
caller's live Agenta credential off `TracingContext.credentials` (via `inject()`'s `Authorization`
re-emit, propagation.py:93-94) and the OTLP endpoint off `ag.tracing.otlp_url` (tracing.py:63), and
ships both as plain fields on `TraceContext.authorization` / `TraceContext.endpoint`
(dtos.py:377-378). `telemetry_to_wire()` (dtos.py:391-403) then nests them under
`exporters.otlp.{endpoint, headers.authorization}` — telemetry *configuration* — rather than a
dedicated field. The docstrings on both sides say this is intentional, not an oversight. That
confirms the runner review's read exactly: the wire has no first-class place to say "here is how
the runner authenticates back to Agenta"; a reviewer of the wire contract has to know to look inside
the OTLP exporter block to find the session's most important credential.

**Concrete failure scenario:** An operator disables or redirects trace export for a deployment
(e.g., to cut OTLP cost, or to point traces at a different collector) by changing
`AGENTA_OTEL_*`-style config upstream of `ag.tracing.otlp_url`. `trace_context()` then returns an
endpoint that no longer matches the platform's real API base, or `None`. The runner — which the
runner review confirms extracts its Agenta credential and API base from this exact block
(`server.ts:118-134`) — loses the ability to heartbeat, persist events, sign mounts, or refresh
itself, none of which have anything to do with tracing. The failure surfaces as a broken session,
not a tracing error, so nobody looking at "did tracing break" would find the cause.

**Recommendation:** Add a first-class field to the wire request — e.g. `platform: {endpoint:
string, authorization: string}` — populated from the same `TracingContext` this code already reads,
and change `_agent()` (app.py:249-260) to pass it into `SessionConfig` alongside (not instead of)
`trace=trace_context()`. Keep `telemetry_to_wire()` emitting the same values for one release so the
runner's existing extraction keeps working during the migration, then delete the OTLP-header path
once the runner reads the first-class field. This is a Python-side, additive change: one new
optional field on `SessionConfig`/the wire DTO, sourced from data this module already has in hand.

**Horizon:** short to centralize (the extraction and the docstring already do this well); medium for
landing the actual wire field, since it is a cross-language contract change that needs the runner
side to land in the same release.

---

### Finding 2 (MEDIUM, short) — `config.py`'s file-based defaults are a third, hand-copied instance of the same literal, with a comment that names files that don't have those names

**Where:** `config.py:18-26` (`DEFAULT_MODEL`, `DEFAULT_AGENTS_MD` and the "kept in sync" comment),
`types.py:1059-1064` (`_DEFAULT_AGENT_MODEL`, `_DEFAULT_AGENTS_MD`).

**What and why:** `config.py` hand-copies the exact "gpt-5.5" / hello-world `AGENTS.md` text that
also lives, verbatim, in `types.py:1059-1064` as the input to `build_agent_v0_default()`. The two
are not the same value by construction (no shared import) — they are two independent string
literals that happen to currently agree. The comment claims they are "kept in sync" against
`schemas.py: _DEFAULT_MODEL / _DEFAULT_AGENTS_MD`, but `schemas.py` never defines names with those
spellings; it only imports `build_agent_v0_default`. This is doc drift on top of a duplication: the
comment describes a sync mechanism that does not exist, referencing a file that does not have what
it says it has. Unlike `build_agent_v0_default`'s single source of truth (Finding-worthy strength,
above), nothing tests that `config.py`'s fallback values match the SDK's canonical defaults.

**Concrete failure scenario:** Someone changes the shipped default instructions or default model in
`types.py` (the one `build_agent_v0_default` actually feeds into `/inspect` and the SDK builtin).
`config.py`'s fallback — which is what actually runs whenever `services/agent/config/AGENTS.md` or
`agent.json` is absent, e.g. a fresh checkout or a minimal Docker layout — silently keeps serving
the old text and the old model id. No test catches the drift, because no test compares the two.

**Recommendation:** Either import `_DEFAULT_AGENT_MODEL` / `_DEFAULT_AGENTS_MD` from
`agenta.sdk.utils.types` directly in `config.py` (collapsing to one source, matching the pattern
`build_agent_v0_default` already established), or add a test parallel to
`test_default_agent_template.py` that asserts `config.DEFAULT_MODEL == types._DEFAULT_AGENT_MODEL`
and the `AGENTS.md` text matches. Fix the comment either way.

**Horizon:** short — this is a small, mechanical fix once someone decides which direction the import
should go.

---

### Finding 3 (HIGH, short) — the published `/inspect` default seeds every new agent onto the `local` sandbox, and nothing here gates that per deployment

**Where:** `schemas.py:41` (`_DEFAULT_AGENT_TEMPLATE = build_agent_v0_default()`),
`types.py:1071,1445` (`_DEFAULT_SANDBOX = "local"`), `app.py:195-207` (`select_backend`).

**What and why:** This is the Python-side surface of the runner review's Theme 4 ("the local
sandbox is not a tenant boundary") and its "must gate the launch" item 4 (force Daytona for tenant
runs). From this lane's vantage: the value every new agent is created with — what the playground
pre-fills and what a bare API caller gets if they omit `sandbox` entirely — is `"local"`, and it is
baked in at the SDK builder level with no environment-aware override anywhere in `schemas.py`,
`config.py`, or `select_backend()`. `select_backend` (app.py:195-207) takes `agent_template.sandbox`
at face value and threads it straight into `SandboxAgentBackend`; there is no check here comparable
to "reject `local` when this deployment is multi-tenant," the kind of check the runner security
review recommends adding on the runner side.

**Concrete failure scenario:** A production, multi-tenant deployment never overrides the agent's
`sandbox` field (most callers will not, since `local` is the advertised default and requires no
extra configuration). Every tenant's agent runs share-host, same-uid, per the runner security
review's F1/F3/F6: one tenant's prompt-injected agent can read another's secrets via `/proc`, reach
another's loopback tool server, or forge another's relay files. Nothing on the Python side would
have refused this combination before the request ever reached the runner.

**Recommendation:** This is primarily a policy decision that the runner and deployment config must
enforce (as the runner review already recommends), but the Python producer should not make the
unsafe choice the path of least resistance. Two independent options, either is a small diff here:
(a) change `_DEFAULT_SANDBOX` (or the value `schemas.py` requests from `build_agent_v0_default`) to
`"daytona"` for any non-development build of the service, gated on an existing deployment-mode env
var; or (b) add a check alongside `select_backend()` that refuses to construct a `SandboxAgentBackend`
with `sandbox="local"` unless an explicit `AGENTA_ALLOW_LOCAL_SANDBOX` (or similar) opt-in is set.
Coordinate with the runner-side fix so the two reject the same combinations the same way.

**Horizon:** short — this is exactly the kind of "must gate the launch" item the runner review
already flagged; the Python side should not ship a default that fights the runner's own hardening.

---

### Finding 4 (LOW, short) — two agent-only env vars are undocumented; no shared env module for this service

**Where:** `config.py:54` (`AGENTA_AGENT_TEMPLATE_DIR`), `tracing.py:32-38`
(`AGENTA_AGENT_CONTENT_CAPTURE_ENABLED`).

**What and why:** `AGENTA_RUNNER_DIR` and `AGENTA_RUNNER_INTERNAL_URL` (also read in `config.py`)
are documented in a table in
`docs/design/agent-workflows/projects/runner-interface/README.md:123` and
`docs/design/agent-workflows/documentation/running-the-agent.md:166`. `AGENTA_AGENT_TEMPLATE_DIR`
and `AGENTA_AGENT_CONTENT_CAPTURE_ENABLED` have zero references anywhere under `docs/` — grepped and
confirmed absent. Separately, the repo's env-config convention (`api/AGENTS.md`: "add new
environment variables to `api/oss/src/utils/env.py` and consume them via the shared `env` object")
scopes explicitly to `api/`; there is no equivalent shared env module for
`services/oss/src/agent/` or for the SDK's `agents/` package, so the four env vars this lane
touched are each read with a direct, ad hoc `os.getenv()` call (config.py:42, 48, 54; tracing.py:32)
rather than through one documented registry. This is not a violation of the stated convention (which
does not claim to cover this directory), but it is the same gap the convention exists to prevent,
one directory over.

**Recommendation:** Add both env vars to the existing runner-interface env-var table (or a
service-scoped equivalent) so operators can find the full list in one place. If the agent surface
grows more env-driven config, consider a small `services/oss/src/agent/env.py` (or extending
`api/oss/src/utils/env.py`'s pattern) rather than letting direct `os.getenv()` calls spread further.

**Horizon:** short for the doc fix (cheap); long if the team decides to formalize a shared env
module.

---

### Finding 5 (LOW, medium) — the content-capture flag is read once at import time, not per call

**Where:** `tracing.py:32-38` (`_CAPTURE_CONTENT = os.getenv(...)`, evaluated at module import).

**What and why:** Every other piece of ambient state `trace_context()` reads (`TracingContext`,
the active span, `ag.tracing.otlp_url`) is read fresh on each call. `_CAPTURE_CONTENT` is the one
exception: it is computed once, when the module is first imported, and then reused for the life of
the process. In a long-lived worker this just means the env var must be set before the process
starts, which is normal for most config — but it also means a test or a script that wants to flip
capture behavior mid-process must monkeypatch the module attribute directly (as any caller
inspecting the env var name would reasonably expect to be able to do by setting the env var), not
the env var itself, which is a small but real footgun for whoever writes the next test here.

**Recommendation:** Either read the env var fresh inside `trace_context()` (cheap; it is one
`os.getenv` call per turn, not a hot loop) or, if the module-level read is intentional for
performance, say so in a one-line comment next to the assignment so the next person does not assume
it is dynamic.

**Horizon:** medium — cosmetic, not worth rushing, but cheap to fix whenever this file is touched
next.

---

### Finding 6 (MEDIUM, short) — `load_config()` has no error handling for malformed `agent.json`, and re-reads both files from disk on every turn

**Where:** `config.py:58-78` (`load_config()`), called per-request via `_default_agent_template()`
(app.py:70-77) inside `async def _agent(...)` (app.py:210-216, no caching between calls).

**What and why:** `load_config()` does `json.loads(meta_path.read_text(...))` (config.py:74) with no
`try/except` and no shape validation on the result: `meta.get("tools", [])` is accepted whatever its
type, and nothing checks that `model` is a string or that `tools` is a list before handing it back
as `AgentTemplate.tools: List[Any]`. Because `AGENTS.md` and `agent.json` are explicitly documented
as editable files (module docstring, config.py:1-6) meant to change the agent without a code change,
this is the one config-parsing path in scope most likely to see a hand-edited, occasionally invalid
file in production. It also runs synchronously, on disk, inside an `async def`, once per agent turn
— there is no caching of the parsed template between requests.

**Concrete failure scenario:** An operator hand-edits `services/agent/config/agent.json` (as the
module docstring invites them to) and leaves a trailing comma or an unclosed brace. The very next
agent invocation raises an uncaught `json.JSONDecodeError` inside `_default_agent_template()`, which
propagates out of `_agent()` as an unhandled 500 instead of a clear "your agent.json is invalid"
error — and every subsequent request fails the same way until someone notices and fixes the file.

**Recommendation:** Wrap the `agent.json` read in a `try/except json.JSONDecodeError` that logs a
clear, actionable error and falls back to the in-code defaults (mirroring how a missing file already
degrades gracefully), and validate that `tools` is a list before returning it. Consider caching the
parsed result (invalidated by mtime, or just loaded once at process start, matching that
`AGENTA_AGENT_TEMPLATE_DIR` is itself an env-set, not hot-reloaded, override) to remove the per-turn
disk I/O.

**Horizon:** short for the error handling (small, load-bearing for anyone editing the file live);
medium for the caching, since it is a minor perf cleanup, not a correctness bug at current scale.

---

### Finding 7 (LOW, medium) — two same-named, differently-shaped `AgentTemplate` classes in the same subsystem

**Where:** `config.py:29-37` (local dataclass `AgentTemplate`: `agents_md`, `model`, `tools`),
`dtos.py:543-641` (SDK `AgentTemplate` Pydantic model: `instructions`, `model`, `model_ref`, `tools`,
`mcp_servers`, `skills`, `harness`, `sandbox`, `permission_default`, ...), both imported/used
together in `app.py:17-18, 70-77`.

**What and why:** `app.py` reads `file_cfg = load_config()` (a `config.AgentTemplate`) and
immediately constructs a different class also called `AgentTemplate` (the SDK's) from it:
`AgentTemplate(instructions=file_cfg.agents_md, model=file_cfg.model, tools=file_cfg.tools)`
(app.py:73-77). The field rename (`agents_md` → `instructions`) at the call site is the only signal
that these are two unrelated classes; nothing else distinguishes them by name. This is a plain
naming collision, not a bug today, but it is exactly the kind of thing that produces a wrong-class
import or a "why doesn't `.agents_md` exist" confusion the next time someone works in this file
without full context.

**Recommendation:** Rename the local dataclass in `config.py` to something that names what it
actually is — the on-disk file default, e.g. `AgentFileDefaults` or `FileTemplate` — leaving
`AgentTemplate` as the SDK's one canonical name for the parsed, runtime template.

**Horizon:** medium — pure naming cleanup, no behavior change, safe to batch with other small
renames.

---

### Finding 8 (informational — reconciliation with A-2 and A-10)

**A-2** (the runner's `process.env` mutation and OTLP-exporter-cache-keyed-on-ephemeral-credential
bugs) **has no mirror in this lane's code.** `trace_context()` (tracing.py:41-76) reads
`TracingContext`/the active span fresh on every call and builds a new `TraceContext` value each
time; there is no module-level cache here keyed on a per-run credential or endpoint. The runner's
A-2 is a runner-only bug (`server.ts`, `otel.ts`) — nothing in this Python code needs the same fix.

**A-10** (the runner's `permission-plan.ts:111` filling a policy default the runner review says
"the SDK/service should own") is **already handled on the Python producer side, as far as this
lane can see.** `AgentTemplate.permission_default` (dtos.py:586) is a non-`Optional` field with a
resolved default (`"allow_reads"`), threaded through `app.py:255-259` into `SessionConfig`, and
`HarnessAgentTemplate` (dtos.py:715) always emits `permissions: {"default": self.permission_default}`
onto the wire — never omitted, since the field can never be `None`. If the runner still needs its
own fallback today, it may already be dead code on that side, or there is a wire-shape mismatch this
lane cannot see from the Python side alone. Worth a one-line confirmation from the wire-contract lane
(B) or the tools/security lane (C), since they own `permission_rules.py` and the wire serialization
in depth; this lane's read is that the Python half of A-10's recommendation is already done.

## 5. Top-10 priority list

1. **Finding 1** — Land the first-class `platform {endpoint, authorization}` wire field; stop
   smuggling the run's credential through OTLP exporter config (short→medium).
2. **Finding 3** — Do not default new agents onto the `local` sandbox with no deployment-aware
   gate; coordinate with the runner's Daytona-forcing fix (short).
3. **Finding 6** — Handle malformed `agent.json` with a clear error instead of an uncaught
   exception; this is the one config-parsing path meant to be hand-edited live (short).
4. **Finding 2** — Fix the stale "kept in sync" comment and either import or test-lock
   `config.py`'s default literals against the SDK's canonical ones (short).
5. **Finding 4** — Document `AGENTA_AGENT_TEMPLATE_DIR` and
   `AGENTA_AGENT_CONTENT_CAPTURE_ENABLED` alongside the other agent env vars (short).
6. **Finding 5** — Read `AGENTA_AGENT_CONTENT_CAPTURE_ENABLED` per call, or comment why it is
   intentionally import-time (medium).
7. **Finding 6 (perf half)** — Cache the parsed file template instead of re-reading disk on every
   turn (medium).
8. **Finding 7** — Rename `config.py`'s local `AgentTemplate` dataclass to remove the naming
   collision with the SDK's `AgentTemplate` (medium).
9. **Finding 8 / A-10** — Get a one-line confirmation from Lane B/C that the runner's permission
   default fallback is genuinely dead code today, and delete it there if so (medium, owned by
   another lane).
10. **Keep** the `build_agent_v0_default` single-source-of-truth pattern (schemas.py:41,
    types.py:1412-1457) as the model to follow when fixing Finding 2 — do not let the fix for one
    duplication introduce a second, differently-shaped one.
