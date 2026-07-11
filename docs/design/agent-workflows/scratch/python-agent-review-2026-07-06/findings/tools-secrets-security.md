# Lane C — Tools, connections, secrets, MCP resolution (security)

Date: 2026-07-06. Reviewer: Lane C (Fable, high effort). READ-ONLY review; no source changed.

## Scope

Service: `services/oss/src/agent/tools/resolver.py`, `tools/gateway.py`, `tools/secrets.py`,
`secrets.py`, plus the resolution/policy parts of `app.py` and `config.py` that this lane
depends on. SDK (`sdks/python/agenta/sdk/agents/`): `platform/op_catalog.py`,
`platform/connections.py`, `platform/connection.py`, `platform/gateway.py`,
`platform/secrets.py`, `platform/platform_tools.py`, `platform/resolve.py`,
`platform/_schema.py`, `platform/workflow.py`, `tools/models.py`, `tools/resolver.py`,
`tools/compat.py`, `tools/errors.py`, `tools/interfaces.py`, `connections/*`, `mcp/*`,
`adapters/agenta_builtins.py`, `adapters/claude_settings.py`, `permission_rules.py`, and the
secret-bearing parts of `dtos.py`, `tracing.py`, `utils/wire.py`, `utils/ts_runner.py`,
`adapters/sandbox_agent.py`, `capabilities.py`. Cross-checked against the runner review
(`runner-review-2026-07-05`): F1, F2, F3, F5, F7, F8, F9 and A-10, A-19.

## How it actually works (verified against code)

**The service is a shell; resolution lives in the SDK.** All four service files under
`services/oss/src/agent/tools/` and `secrets.py` are thin re-exports of
`agenta.sdk.agents.platform` (`tools/gateway.py:9-13`, `tools/secrets.py:7-10`,
`secrets.py:12-15`). The one thing the service adds is the MCP deployment gate:
`AGENTA_AGENT_MCPS_ENABLED`, **default on** (`tools/resolver.py:27`), which raises a loud
`MCPDisabledError` when the flag is off but the request declared servers
(`tools/resolver.py:44-50`, `mcp/errors.py:25-42`) instead of silently stripping them.

**Three resolution entrypoints** (`platform/resolve.py`): `resolve_tools`, `resolve_mcp`,
`resolve_connection`, each defaulting to platform-backed adapters but accepting injected
fakes/offline adapters. The service calls them per turn from `app.py:232-247`. A fourth,
`resolve_secrets` (the model-blind whole-vault dump, `platform/secrets.py:105-150`), is
deprecated and **no longer on the `/invoke` path** — `app.py` resolves exactly one
least-privilege connection instead.

**Tool kinds.** Six config kinds (`tools/models.py:246-256`) resolve to three spec kinds:

- `builtin` → a name list (Pi grants; Claude drops them with a warning,
  `adapters/harnesses.py:90-94`).
- `gateway` (Composio) → `POST /tools/resolve` on the platform, one `CallbackToolSpec` with a
  `call_ref` per action, plus one shared `ToolCallback(endpoint=…/tools/call, authorization)`
  (`platform/gateway.py:52-208`). Non-composio providers are refused up front (`gateway.py:62-64`).
- `reference` (workflow-as-tool) → a `CallbackToolSpec` with `call_ref = workflow.{axis}.*`,
  no HTTP round trip (`platform/workflow.py:48-111`).
- `platform` → the op catalog (below); endpoint-mode ops carry a direct `call` descriptor,
  handler-mode ops a reserved `call_ref` with spec-level `context_bindings`
  (`platform/platform_tools.py:93-115`).
- `code` → a `CodeToolSpec` with vault-resolved secret values in `env`
  (`tools/resolver.py:159-176`). The runner refuses code tools unconditionally.
- `client` → a browser-fulfilled `ClientToolSpec`.

Duplicate model-visible names fail loud (`tools/resolver.py:84-93`). Code-tool and MCP secrets
resolve through `POST /secrets/resolve` with `MissingSecretPolicy.ERROR`
(`platform/secrets.py:29-78`, `mcp/resolver.py:39-56`); the response is restricted to the
requested names so an over-returning upstream cannot leak extras into memory
(`platform/secrets.py:72-78`).

**The op catalog is not Composio.** `platform/op_catalog.py` is a code-defined, import-validated
table of 19 existing Agenta endpoints exposed as agent tools (discover/query/trigger/commit ops).
Each `PlatformOp` is a frozen pydantic model that enforces: exactly one schema source, exactly one
target mode (method+path XOR an allowlisted handler ref), a single-`/` relative path, and
well-formed `$ctx.` binding tokens (`op_catalog.py:99-149`). Self-targeting is done right:
server-bound fields (`workflow_variant_id`, `trace_id`/`span_id`) are declared as
`context_bindings`, stripped from the model-visible schema path-aware including `required`
(`op_catalog.py:156-236`), and the mutating ops close their schemas with
`additionalProperties: false` so the model cannot smuggle a `links`/`references` retarget past the
binding (`op_catalog.py:643-691`, `734-770`, `776-806`). The runner applies context bindings last,
so even a smuggled field is overwritten. It is coherent; the 1105 lines are mostly literal JSON
Schema data.

**Connection resolution** (`platform/connections.py`). `VaultConnectionResolver` fetches
`GET /secrets/` with the caller's request auth, builds an in-memory candidate catalog from
`provider_key` and `custom_provider` records, and deterministically selects one connection for the
`ModelRef` (model-id match first, then provider match; a `default`-named candidate breaks ties;
anything else raises a specific error, `connections.py:364-434`). `self_managed` short-circuits to
an empty plan (`connections.py:447-453`). Extras env is **allowlisted**
(`_ALLOWED_EXTRA_ENV_KEYS`, `connections.py:135-164`), so a vault record cannot inject arbitrary
env vars (no `LD_PRELOAD`, no `PI_*`) into the harness daemon. The harness capability check runs
in the agent layer around the resolve (`app.py:95-129`, table in `capabilities.py:145-167`); the
vault resolve itself stays harness-agnostic. The default (slug-less) connection is tolerant of
resolution failure and degrades to `runtime_provided` with a log warning (`app.py:171-192`); a
named connection fails loud.

**Where secret values live and travel.** Four channels reach the wire, all inside the `/run` body
POSTed to the runner (`utils/wire.py:123-155`, transport `utils/ts_runner.py`):

1. The provider key: `ResolvedConnection.env` → `SessionConfig.secrets` (`app.py:247,257`) → the
   wire `secrets` field (`wire.py:130`) → the runner injects it into the daemon/sandbox env.
2. Code-tool secrets: `CodeToolSpec.env` inside `customTools[]` (dead today; the runner refuses
   code tools).
3. MCP secrets: `ResolvedMCPServer.env` inside `mcpServers[]` (`mcp/models.py:77-94`); for http
   servers the env keys are header names the harness sends when it dials the server directly.
4. The caller's platform bearer: `tracing.py:41-76` captures the active request's `Authorization`
   and the OTLP endpoint; `TraceContext.telemetry_to_wire()` nests it under
   `telemetry.exporters.otlp.headers.authorization` (`dtos.py:391-403`). This is the producer side
   of runner findings A-1/F2.

Nothing logs a secret value: logs carry counts and names only (`platform/secrets.py:51-71`),
`sanitize_runner_error` and `_transport_error` keep raw runner detail out of user-facing errors
(`wire.py:54-75`, `ts_runner.py:35-44`), and `ResolvedConnection.to_wire()` never emits `env`
(`connections/models.py:185-202`).

**Permissions.** The service **always** sends an explicit `permissions.default` on the wire:
`wire_permissions()` unconditionally emits `{"permissions": {"default": self.permission_default}}`
(`dtos.py:713-719`), included by both harness templates' `wire_tools()` (`dtos.py:849-857`,
`887-895`) and pinned by the golden fixture (`golden/run_request.pi_core.json:74`). The default is
`allow_reads` (`dtos.py:586`). Author rules come from the harness `permissions` slice
(`permission_rules.py:39-52`; `mcp__` patterns excluded from the runner wire to avoid
double-counting). Per-builtin permissions are unenforceable on Pi and are dropped **loudly**
(`tools/models.py:87-102`). For Claude, `claude_settings.py` renders `.claude/settings.json` from
four merged rule sources (author, sandbox-permission floor, per-MCP-server, per-resolved-tool
F-046 rules) as a generic `harnessFiles` entry; the runner is a dumb file writer.

**Doc drift found while verifying** (details in finding C11): eight design docs cite the MCP flag
as `AGENTA_AGENT_ENABLE_MCP` off-by-default (real: `AGENTA_AGENT_MCPS_ENABLED`, default true);
the runner's own `mcp.ts:37` comment also says "off by default"; `platform/secrets.py:118-121`
claims `app.py` still calls the whole-vault dump (it does not); `tools/models.py:337-341` says no
resolver emits `call` and no dispatch reads it (the op catalog emits it and the runner dispatches
it); error messages tell users to set `AGENTA_AGENT_TOOLS_API_URL`, which nothing reads.

## Strengths — keep this

- **Least-privilege connection resolution replaced the whole-vault dump.** One model, one
  connection, one provider's env vars; ambiguity and mismatches raise specific, actionable errors
  instead of picking by iteration order (`connections.py`, `connections/errors.py`). This is the
  single biggest security improvement over the old `resolve_provider_keys` path, and the
  deprecated path is genuinely off the `/invoke` route.
- **The extras env allowlist.** `_ALLOWED_EXTRA_ENV_KEYS` + `_SNAKE_EXTRA_ENV_ALIASES`
  (`connections.py:124-164`) means a vault record can only ever set known credential env vars in
  the harness environment. This closes an arbitrary-env-injection class before it exists.
- **Self-targeting platform ops are designed correctly.** Context bindings are stripped from the
  model-visible schema (including `required`, with empty-ancestor pruning), mutating schemas are
  closed with `additionalProperties: false`, bindings are applied last at dispatch, and the
  handler allowlist is checked at import (`op_catalog.py`). The model cannot retarget another
  variant or trace.
- **Fail-loud discipline at the resolution boundary.** `MCPDisabledError` instead of silent
  stripping; `MissingSecretPolicy.ERROR`; duplicate-name, duplicate-reference, and
  count-mismatch checks on gateway resolution (`gateway.py:81-170`); the loud drop of
  unenforceable builtin permissions. This mirrors the runner's best property.
- **Secret hygiene in logs and errors.** Counts and names only; sanitized runner errors; the
  one-line user message with full detail logged (`wire.py:54-75`, `ts_runner.py:35-44`).
- **Credential resolved once, reused.** The gateway/workflow/platform resolvers resolve the
  caller credential once and thread the same value into the request header and the
  `ToolCallback`, so the two cannot diverge (`gateway.py:75-78`, `platform_tools.py:67-69`).
- **Per-call authorization, never process-global.** `PlatformConnection` resolves the caller's
  credential lazily per access from the request's tracing propagation (`connection.py:101-152`),
  so one caller's credential cannot leak into another's run in the shared service. This is the
  exact discipline the runner lacked (its `process.env.AGENTA_API_URL` bug).
- **The permission wire is pinned.** Golden fixtures carry `permissions.default`, and
  `test_permission_parity.py` mirrors the runner's decision table from the Python side.

## Findings

### C1 — HIGH (gates the multi-tenant launch): no server-side policy gate on the sandbox/permission axes; any tenant can request `sandbox:"local"` + `default:"allow"`

`dtos.py:584-586` (defaults `sandbox="local"`, `permission_default="allow_reads"`),
`dtos.py:1110-1130` (`_parse_run_selection` accepts any lowercased string for `sandbox` and any of
the four modes for the default, straight from the request body), `app.py:195-207`
(`select_backend` forwards `agent_template.sandbox` verbatim), `config.py` (no policy env var
exists).

The runner review's launch gate (F1, F5, and the executive summary's theme 4) says the fix
belongs here: "force Daytona for tenant runs at the Python service and reject
`sandbox:'local'`". Verified: nothing implements it. The sandbox kind and the permission default
are author-editable config fields with no deployment-level restriction, no allowlist of sandbox
ids, and no refusal of the `local`+`allow` combination.

- **Failure scenario:** on a shared multi-tenant deployment, tenant A commits an agent config
  with `sandbox.kind:"local"` and `runner.permissions.default:"allow"`, then prompts "run
  `cat /proc/*/environ`". The harness runs as a child process on the shared runner host under the
  same uid as every other tenant's daemon; with `allow`, no builtin gating hook is even
  registered (runner F5). Tenant A reads tenant B's provider key and platform bearer. No prompt
  injection is required; the tenant does this on purpose.
- **Bonus hole:** because `_parse_run_selection` accepts any string, a typo'd or hostile sandbox
  id rides the wire, and the runner (its F5) falls back to running on the host instead of
  refusing. The Python side should whitelist `{"local", "daytona"}` regardless of the runner fix.
- **Recommendation:** add a deployment policy in the service (env-driven, via the shared `env`
  object): `AGENTA_AGENT_ALLOWED_SANDBOXES` (cloud default: `daytona`) and a refusal of
  `default:"allow"` when the resolved sandbox is `local` in shared deployments. Validate the
  sandbox kind against a literal set at parse time and fail loud on anything else. This is a
  ~50-line change in `app.py`/`dtos.py` plus compose defaults.
- **Horizon: short** (policy + validation before launch); **long** for real per-run isolation on
  `local`.

### C2 — HIGH: the caller's reusable bearer is captured here and shipped as telemetry config that ends up agent-readable (confirms runner F2/A-1 from the producer side)

`tracing.py:41-76` (`trace_context()` reads the caller's `Authorization` off the tracing
propagation), `dtos.py:391-403` (`telemetry_to_wire` nests it under
`telemetry.exporters.otlp.headers.authorization`), `wire.py:136-137`.

The Python side is the producer of the design the runner review flagged: the platform credential
the runner uses for heartbeats, persistence, and mounts has no first-class wire field; it rides
inside exporter config, and the runner injects it into the harness environment
(`OTEL_EXPORTER_OTLP_HEADERS`), which crosses into the Daytona sandbox. The credential is the
caller's reusable bearer (an `ApiKey …` or an ephemeral `Secret …`), not a trace-ingest-scoped
token.

- **Failure scenario:** a prompt-injected agent on Daytona with default-open egress runs
  `env | grep -i otel`, extracts the bearer, and POSTs it out; the attacker impersonates the user
  against the platform until the credential expires (runner F2's scenario, origin confirmed
  here).
- **What Python can do:** (a) short term, keep threading the credential to the RUNNER (it needs
  it for sessions/tools) but stop it reaching the harness env — that half is a runner change; the
  Python half is to make the roles explicit with the first-class `platform {endpoint,
  authorization}` block (runner A-1) so "runner-facing platform credential" and "in-harness
  exporter config" stop being one field. (b) medium term, mint a short-lived, audience-scoped
  trace-ingest token here (the service is the right place: it has the caller's identity and the
  API) and put only that in the exporter headers. The wire restructure already half-done in
  `telemetry_to_wire` (credential nested under exporter headers, capture policy separated) makes
  this a contained change.
- **Horizon: short** (first-class field, coordinated with the runner), **medium** (scoped token).

### C3 — MEDIUM: provider keys and http-MCP header secrets are agent-readable by design (confirms runner F9; structural)

Provider key: `app.py:246-247` → `SessionConfig.secrets` → `wire.py:130` → runner daemon/sandbox
env. MCP headers: `mcp/resolver.py:52-56` (secret values into `env`) →
`ResolvedMCPServer.to_wire` (`mcp/models.py:77-94`) → the harness dials the server directly with
those headers.

This is inherent to "the harness calls the model/MCP server directly": the Python side resolves
the secret and must hand it to the process the model steers. The mitigation Python already ships
is least-privilege (one connection's env, never the whole vault). The remaining exposure is
runner F9's: an Agenta-managed shared key is readable by prompt-injected code on every run.

- **Recommendation:** this is exactly the scope of the existing
  `docs/design/agent-workflows/projects/secret-isolation/` workspace (provider key and MCP
  headers out of the sandbox; Pi http MCP via a backend gateway). Land that design after launch;
  in the interim, document that managed keys are exposed to the agent and prefer Daytona egress
  restriction where available. No new mechanism needed in this lane beyond that project.
- **Horizon: medium/long.**

### C4 — MEDIUM: the "decide" side emits combinations the "run" side refuses, and resolves secrets for runs that are doomed

`tools/resolver.py:159-176` (code-tool secrets resolved from the vault, values placed in
`CodeToolSpec.env`, shipped on the wire — the runner then refuses any run carrying a `code`
tool), `mcp/models.py:30-54` (stdio MCP parses and resolves fine — the runner refuses stdio
always, and refuses ANY user MCP on Pi), `capabilities.py` (the capability table covers only
connection facts; tool-delivery capability lives nowhere on the Python side).

The division of labor is "Python decides what to run; the runner runs it". Today the runner is
the only place that knows Pi takes no user MCP, stdio MCP is sealed, code tools are sealed, and
non-Pi remote sandboxes cannot take custom tools. The Python side happily resolves all of them:
it fetches real secret values from the vault, puts them in the wire request, and lets the runner
refuse the run afterwards. The user gets a loud error (good), but from the wrong layer, after
credentials were resolved and shipped for a run that could never start.

- **Failure scenario:** a config with one code tool declaring secret `FOO`. The vault value of
  `FOO` is read, placed into `customTools[0].env`, POSTed to the runner (plaintext HTTP on the
  internal network, runner F8), and the runner replies "code tools are not supported". The
  secret took a round trip it never needed to take. Same shape for a stdio MCP server's env.
- **Recommendation:** add a capability check on the decide side, next to the existing
  harness-connection check (`app.py:95-129`): refuse code tools, stdio MCP, and Pi+user-MCP
  before any secret resolution runs, with the same quality of message the runner produces. Keep
  the runner gates as defense in depth. Extend `capabilities.py` (or the harness adapter) with
  the tool-delivery facts so the knowledge has one Python home.
- **Horizon: short** (the three refusals are cheap); **medium** (fold into the capability table).

### C5 — MEDIUM: two secret-bearing fields are unmasked in repr, unlike every other secret field

`dtos.py:950` (`SessionConfig.secrets` — a `Dict[str, str]` of live provider keys, no
`repr=False`), `dtos.py:378` (`TraceContext.authorization` — the caller bearer, no `repr=False`).
Contrast: `ResolvedConnection.env` (`connections/models.py:180-182`), `ToolCallback.authorization`
(`tools/models.py:266`), `CodeToolSpec.env` (`tools/models.py:404`), and both MCP `env` fields
(`mcp/models.py:37,64`) are all masked.

- **Failure scenario:** any future `log.warning("bad session config: %r", session_config)` or an
  exception message that interpolates the model (easy to add in a debugging session, and pydantic
  validation errors echo input data) prints `{"OPENAI_API_KEY": "sk-…"}` and the caller bearer
  into service logs.
- **Recommendation:** add `repr=False` to both fields. Two lines. Consider a
  `SecretStr`-or-masked-dict convention for any future secret-bearing field.
- **Horizon: short.**

### C6 — MEDIUM: a vault outage is indistinguishable from a missing secret, producing a wrong diagnosis

`platform/secrets.py:43-64` (`resolve_named_secrets` catches every exception and every HTTP
status ≥400 and returns `{}`), paired with `MissingSecretPolicy.ERROR` in
`tools/resolver.py:161-170` and `mcp/resolver.py:41-50`.

The "best-effort" contract was designed for the optional provider-key dump, but the named-secret
path feeds a hard-fail policy. When the vault is down, the resolver returns empty, and the user
is told their tool "is missing required secret(s): FOO" although FOO exists.

- **Failure scenario:** the API's `/secrets/resolve` returns 500 during a deploy. Every run with
  an MCP server or code tool fails with `MissingToolSecretError`/`MissingMCPSecretError` naming
  secrets that are present in the vault. The user "fixes" their config instead of the operator
  fixing the outage.
- **Related, accepted for rollout:** the tolerant default-connection path (`app.py:171-192`)
  degrades a vault/network failure to "no injected credential", which later surfaces as the
  provider's misleading "add your key" error. This is documented as intentional pending the
  model-config `AGENTA_AGENT_MODEL_STRICT` flag; it logs a warning. Fine for launch, but the same
  outage-vs-absence ambiguity.
- **Recommendation:** let `resolve_named_secrets` distinguish transport/HTTP failure from
  a-name-was-not-found: raise (or return a marked result) on outage so the run fails with "secret
  resolution unavailable", and reserve `Missing…SecretError` for a 2xx response that lacked the
  name.
- **Horizon: medium.**

### C7 — MEDIUM: three hand-copied provider→env tables have already drifted (minimax)

`platform/connections.py:41-51` (has `minimax`), `platform/secrets.py:93-102` (no `minimax`),
`connections/resolver.py:31-40` (no `minimax`), while `capabilities.py:45-54` lists `minimax` as
a Pi vault provider. The comment in `connections/resolver.py:29-30` claims "same shape and
entries as `platform/secrets.py`" — true, but both are behind the live table.

- **Failure scenario:** a standalone SDK user sets `MINIMAX_API_KEY` in their env and runs a
  `minimax/abab-…` model through `EnvConnectionResolver`. The lookup misses, the resolver
  silently returns `runtime_provided` with empty env (`connections/resolver.py:82-97`), and the
  harness fails with a provider auth error even though the key is right there. No error names the
  real cause.
- **Recommendation:** one `PROVIDER_ENV_VARS` table in one module (`connections/models.py` or
  `capabilities.py`), imported by the other three; add a unit test asserting
  `set(PI_VAULT_PROVIDERS) <= set(PROVIDER_ENV_VARS)`.
- **Horizon: short.**

### C8 — LOW: an invalid permission default silently coerces to `allow_reads`

`dtos.py:1122-1129`: an unrecognized `runner.permissions.default` value is replaced with
`"allow_reads"` with no log and no error.

- **Failure scenario:** an author writes `default: "denied"` (or a future FE bug sends a new
  vocabulary value). The intent was deny-everything; the run executes under `allow_reads`, which
  is strictly more permissive. Policy should never widen silently.
- **Recommendation:** fail loud on an unknown mode (it is author-visible config), or at minimum
  coerce toward the more restrictive `ask` and log a warning. Mirror whichever choice in the
  parity test.
- **Horizon: short.**

### C9 — LOW: `MCPServerConfig` defaults `transport="stdio"`, so the natural http declaration fails with a wrong error

`mcp/models.py:34-54`: `{name: "x", url: "https://…"}` without an explicit `transport` validates
as stdio and fails with "stdio MCP server requires command". Since http is the only transport the
runner serves, the default points at the dead variant.

- **Failure scenario:** a user declares an MCP server with just a name and a URL (the shape every
  other product uses for hosted MCP). They get "stdio MCP server requires command", mentioning a
  transport they never asked for.
- **Recommendation:** infer the transport (`url` present and no `command` → http) or flip the
  default to http; keep the explicit-both/neither cases loud.
- **Horizon: short.**

### C10 — LOW: error messages instruct users to set an env var that nothing reads

`platform/platform_tools.py:62` and `platform/workflow.py:56` say "Set
AGENTA_AGENT_TOOLS_API_URL or AGENTA_API_URL"; no code reads `AGENTA_AGENT_TOOLS_API_URL` (grep:
only these two strings and one archived doc). `platform/gateway.py:70` has the correct message.

- **Recommendation:** align both messages with `gateway.py` ("Set AGENTA_API_URL").
- **Horizon: short.**

### C11 — LOW (but fix before launch, it misleads): doc/comment drift cluster around this lane

Confirms runner A-19 from the Python side, plus new instances:

- **MCP flag name and polarity.** Real: `AGENTA_AGENT_MCPS_ENABLED`, default `"true"`
  (`services/oss/src/agent/tools/resolver.py:27`). Stale `AGENTA_AGENT_ENABLE_MCP` +
  off-by-default in: `documentation/ground-truth.md:55`, `ports-and-adapters.md:162`,
  `architecture.md:115`, `agent-configuration.md:220`, `adapters/claude-code.md:53`,
  `tools.md:165,359,570`. Also stale in the runner's own source comment
  (`services/runner/src/engines/sandbox_agent/mcp.ts:37`, "off by default") and in
  `projects/mcp-delivery-architecture/README.md:9` / `directions.md:61`.
  `documentation/running-the-agent.md:170` is correct — use it as the template.
- `platform/secrets.py:118-121` claims "the running agent service still calls it via
  `resolve_secrets` in `services/oss/src/agent/app.py`" — false; `app.py` uses
  `resolve_connection` only. Slice 3 (delete the dump) is now unblocked.
- `tools/models.py:337-341` (`ToolCall` docstring): "no resolver emits it and no dispatch reads
  it yet" — false; `op_catalog.to_call()`/`platform_tools.py:102` emit it and the runner's
  `direct.ts` dispatches it with the SSRF guard already built.
- `services/oss/src/agent/tools/resolver.py:5-7` says the gate "covers http MCP servers only" —
  the Python gate covers all declared servers; what is http-only is what the runner will serve.
  Reword.
- **Recommendation:** one doc-sweep commit; delete `resolve_provider_keys` and its re-export
  chain (`services/oss/src/agent/secrets.py`) once the one deprecated integration test moves
  over.
- **Horizon: short.**

### C12 — LOW: the reserved internal MCP server name is only exact-match protected

`adapters/claude_settings.py:119-122` skips a user MCP server named exactly `agenta-tools`, but a
server named `agenta-tools__commit_revision` with `permission:"allow"` renders the rule
`mcp__agenta-tools__commit_revision`, colliding with the per-resolved-tool rule namespace and
auto-allowing that platform tool in Claude's gate. The author already controls per-tool
permissions, so this is self-authorization, not privilege escalation across a trust boundary —
but it is a namespace collision that will confuse a future audit.

- **Recommendation:** reject (or skip with a warning) user MCP server names equal to
  `agenta-tools` OR starting with `agenta-tools__`; consider refusing `__` in server names
  entirely since Claude uses it as the rule separator.
- **Horizon: medium.**

### C13 — LOW: `_choose_named` raises "ambiguous" for a no-match, and duplicates a branch

`platform/connections.py:410-416`: when several vault records share the slug and none matches the
model, `narrowed` is empty and the code raises `AmbiguousConnectionError` — the message says
"connection names must be unique" when the real problem is "the named connection does not serve
this model". The `len(narrowed) > 1` branch and the fall-through raise the identical error
(dead duplication).

- **Recommendation:** raise `ProviderMismatchError`/`ConnectionNotFoundError` with a
  model-centric message for the empty-narrowed case; collapse the duplicate raise.
- **Horizon: medium.**

### C14 — LOW: in the shared service, a lost request context silently falls back to process-level credentials

`platform/connection.py:72-98` (`_derive_authorization`): explicit → per-request propagation →
`AGENTA_API_KEY` → `AGENTA_CREDENTIALS`. The env fallbacks exist for the standalone SDK, where
the process key IS the user's key. In the shared service, if resolution ever runs outside the
request's `TracingContext` (a detached asyncio task, a background refresh, a future code path),
the run resolves tools and secrets under whatever credential the service process happens to hold,
with no error.

- **Failure scenario:** a future refactor moves tool resolution into a spawned task that does not
  copy contextvars. `inject({})` returns no Authorization; if the container has `AGENTA_API_KEY`
  set (some deployments do for tracing), every affected run resolves the vault under that one
  project's identity — cross-tenant credential confusion with zero signal.
- **Recommendation:** add a service-mode switch (or detect "running inside `/invoke`") that makes
  a missing per-request credential fail loud instead of falling back to env. The standalone
  default stays as is.
- **Horizon: medium.**

### C15 — LOW: templated path params in the op catalog lean entirely on the runner's character blacklist

`op_catalog.py:1048-1094`: five ops carry `{id}` path templates
(`/api/triggers/schedules/{id}` etc.); the id is model-supplied. The runner's `direct.ts` guard
rejects `..`, backslash, and CRLF, and origin-locks the call — good — but nothing URL-encodes the
substituted value, so the residual surface is percent-encoded traversal (`%2e%2e`) and
query-string injection (`?`/`#` in the id), which land inside the locked Agenta origin and API
mount but could reach a different endpoint than the catalog intended.

- **Failure scenario:** the model calls `remove_schedule` with
  `id = "x?cascade=true"` or `id = "%2e%2e/subscriptions/y"`. Depending on the runner's exact
  substitution and the server's decoding, the DELETE lands on a different in-origin route than
  `/api/triggers/schedules/<uuid>`. Blast radius is capped by the caller's own credential and the
  origin lock, so this is hardening, not a break.
- **Recommendation:** URL-encode path-param substitution in the runner, and add a shared golden
  test (both languages) pinning that a hostile id is rejected or encoded. From the Python side,
  declare path params explicitly (e.g. `path_params: ["id"]` with a `format: uuid` schema) so the
  catalog states the contract instead of implying it.
- **Horizon: medium.**

## Reconciliation with the runner review

- **F1 / F5 (local is not a tenant boundary; `allow` disables gating): CONFIRMED, and the fix
  belongs here.** No Python-side policy restricts `sandbox` or refuses `local`+`allow`; the
  sandbox string is not even validated against a known set (`dtos.py:1110-1130`,
  `app.py:195-207`). Finding C1.
- **F2 (caller bearer in agent-readable env): CONFIRMED as originating here.** `tracing.py:71`
  captures the caller's Authorization; `dtos.py:391-403` ships it as exporter-header config. The
  Python side cannot keep it out of the harness env alone (the runner injects it), but it is the
  right place to mint a scoped trace-ingest token and to introduce the first-class `platform`
  block. Finding C2.
- **F9 (provider keys readable by the harness): CONFIRMED, structural.** Origin `app.py:246-247`
  → wire `secrets`. Python already minimized it to one least-privilege connection; the rest is
  the secret-isolation project. Finding C3.
- **F7 (gateway callback endpoint is config-trusted): CONFIRMED from the producer side.** The
  endpoint is always `{api_base}/tools/call` assembled server-side (`gateway.py:202-208`,
  `platform_tools.py:117-123`, `workflow.py:105-111`); it never comes from the request body. The
  runner's origin-lock recommendation stands as defense in depth.
- **F8 (`/run` unauthenticated by default): CONFIRMED.** The Python transport already supports
  the token (`ts_runner.py:21-32` sends `Authorization: Bearer` when `AGENTA_RUNNER_TOKEN` is
  set); turning it on is purely a compose default. Note the wire body carries plaintext provider
  keys plus two bearers, so the token + unpublished port matter.
- **A-10 (runner fills a policy default the service should own): REFUTED in its strong form,
  CONFIRMED in its weak form.** The service ALWAYS sends `permissions.default` explicitly
  (`dtos.py:713-719`; golden `run_request.pi_core.json:74`), so the runner's `allow_reads`
  fallback is dead code for every service-originated run — it is live only for direct `/run`
  callers. Keep the runner fallback as defense; the ownership already sits on the Python side.
  Residual nit: the literal `"allow_reads"` default is declared in three Python places
  (`dtos.py:586,681,955`) plus the runner — one constant would prevent drift.
- **A-19 (MCP flag documented with wrong name and polarity): CONFIRMED and extended.** Real flag
  `AGENTA_AGENT_MCPS_ENABLED`, default `"true"` (`services/oss/src/agent/tools/resolver.py:27`);
  eight docs plus the runner's own `mcp.ts:37` comment are wrong. Finding C11.
- **F3 (unauthenticated internal MCP channel): out of Python's code, but note** the Python side
  already ships MCP `headers` on the wire shape, so the runner's per-run-token fix has a natural
  delivery path; no Python change needed beyond accepting the field.

## Top-10 priority list

| # | Finding | Severity | Horizon |
|---|---------|----------|---------|
| 1 | C1 — whitelist sandbox ids; force Daytona / refuse `local`+`allow` for tenant runs (policy gate in the service) | HIGH | short |
| 2 | C2 — first-class platform credential block; scoped trace-ingest token instead of the caller bearer | HIGH | short/medium |
| 3 | C5 — `repr=False` on `SessionConfig.secrets` and `TraceContext.authorization` | MEDIUM | short |
| 4 | C4 — decide-side refusals for code tools, stdio MCP, Pi+user-MCP, before secret resolution | MEDIUM | short |
| 5 | C7 — single provider→env table (minimax drift already live) | MEDIUM | short |
| 6 | C11 — doc sweep: MCP flag name/polarity everywhere; delete the deprecated vault dump | LOW | short |
| 7 | C6 — distinguish vault outage from missing secret in named-secret resolution | MEDIUM | medium |
| 8 | C8 — fail loud (or coerce restrictive) on an unknown permission default | LOW | short |
| 9 | C9 — infer MCP transport from `url`/`command`; stop defaulting to the dead stdio variant | LOW | short |
| 10 | C3 — land the secret-isolation design (provider keys + MCP headers out of the sandbox) | MEDIUM | medium/long |

Severity counts: **0 blocker, 2 high (C1, C2), 5 medium (C3, C4, C5, C6, C7), 8 low
(C8-C15)**. C1 must gate a multi-tenant launch; on a single-tenant or Daytona-forced deployment
it drops to hardening.
