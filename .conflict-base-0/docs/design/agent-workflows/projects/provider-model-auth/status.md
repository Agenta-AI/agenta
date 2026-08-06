# Status

Source of truth for where this work stands. Keep it current.

## State

**PR #4815 OPEN to `big-agents`** (2026-06-24), MERGEABLE, from lane
`feat/agent-provider-model-connection` (39 non-shared pure files). The shared-file integration
hunks (`dtos.py` `model_ref`, wire, `protocol.ts`, `pi.ts`, …) ride in skills' PR #4814 at zero
drift; **#4815 must merge before/with #4814** (its `dtos.py` imports the `connections/` module that
lives only in #4815). Coordination recorded in `scratch/agent-coordination.md`. Awaiting code
review. Earlier in-run state below.

**Implemented locally (headless run, 2026-06-24), committed to lane
`feat/agent-provider-model-connection`.** All 5 slices are written, each
reviewed by a subagent and green on unit/integration/golden tests. Live feature-matrix
verification (two OpenAI connections, a custom base_url, a self-managed run on the running
stack) is DEFERRED — it needs a running stack + vault keys this headless run cannot drive.

What shipped:
- SDK neutral types + resolver port + offline adapters (`agents/connections/`), `ModelRef`
  threaded into the config, wire non-secret fields on both sides.
- API internal-only `POST /vault/connections/resolve` + `GET /vault/connections` with the
  deterministic rules, capability reject, fail-loud on cloud deployments, audit (never the key).
- `VaultConnectionResolver` + the live `app.py` swap (one least-privilege connection replaces the
  whole-vault dump), with graceful degradation for the unconfigured default case.
- TS engines: clear-then-apply env (no inherited key leak), OAuth-upload gated on
  runtime_provided, Claude `ANTHROPIC_BASE_URL`.
- A minimal FE connection form (provider/mode/slug + raw-JSON), harness-gated.

What is deferred (see "Deferred" in design.md + scratch/open-issues.md):
- Live feature-matrix verification.
- Pi custom-endpoint write (auth.json/models.json) — owned by the model-config sibling; this
  project chooses the connection that feeds it.
- The full capability-table mechanism + `/inspect` — owned by harness-capabilities; this project
  ships a minimal `providers`/`connection_modes` table.
- The live connection-slug picker from `GET /vault/connections` — needs a Fern client regen.
- Stale `install_http` integration fixture (pre-existing, logged in scratch/open-issues.md).

Last updated: 2026-06-24.


## 2026-06-24 replan: no new connection routes

Decision: rework PR #4815 to avoid the new `GET /vault/connections` and
`POST /vault/connections/resolve` routes. The agent service/SDK should use the existing
`GET /secrets/` payload, build an in-memory catalog of `provider_key` and `custom_provider`
records, select one connection by `ModelRef.connection` and model, then pass only that selected
connection's env/config to the harness. This preserves the existing vault data model and avoids a
new secret-bearing API surface.

Claude Code model handling: do not add `family` / `harness_model` metadata to
`custom_provider.data.models[].extras` for v1. For Bedrock/Vertex/custom gateways, pass the selected
custom model id through to Claude Code with the relevant backend env (`CLAUDE_CODE_USE_BEDROCK`,
`CLAUDE_CODE_USE_VERTEX`, `ANTHROPIC_MODEL` or `ANTHROPIC_CUSTOM_MODEL_OPTION`). If the configured
backend rejects an arbitrary model id such as `gpt-5.5`, the explicit run should fail loudly. Schema
metadata can be added later for UX/prevalidation/capability hints, but it is not required for the
minimal behavior.

Implementation handoff: use GitButler only. Work on lane `feat/agent-provider-model-connection`
for #4815, keep shared-file hunks coordinated with #4814, commit regularly, and before pushing ask
Claude to run the implementation-debug/check workflow recorded in
`docs/design/agent-workflows/scratch/agent-coordination.md`.

## Phase 0 plan refresh (drift corrections + sibling state)

Citations re-verified against current code. Corrections to the plan/design line numbers:

- `AgentConfig.model` is `sdks/python/agenta/sdk/agents/dtos.py:361`; `HarnessAgentConfig.model`
  `:458`; `SessionConfig.secrets` `:631` (`Dict[str, str]`). All top-level classes confirmed.
- The whole-vault dump now lives in the SDK at
  `sdks/python/agenta/sdk/agents/platform/secrets.py:105-141` (`resolve_provider_keys`), with
  `_PROVIDER_ENV_VARS` at `:91-102`. `services/oss/src/agent/secrets.py` is now only a thin
  re-export. `services/oss/src/agent/app.py:_agent()` calls `resolve_secrets()` at line ~83 via
  `PlatformConnection` (auth derived from per-request OTel propagation, fallback `AGENTA_API_KEY`);
  it takes no model and no explicit project id (the API key carries project scope).
- Wire: `services/agent/src/protocol.ts` `AgentRunRequest` is at lines ~247-302; `model` `:273`,
  `secrets` `:257`. No zod; TS types + golden fixtures + a compile-time `KNOWN_REQUEST_KEYS`
  guard (`services/agent/tests/unit/wire-contract.test.ts`). Python golden at
  `sdks/python/oss/tests/pytest/unit/agents/golden/run_request.{pi,claude}.json`, asserted by
  `sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py` and the TS test.
- TS engines are refactored into `services/agent/src/engines/sandbox_agent/` submodules:
  `run-plan.ts` (`harnessKeyVar`/`hasApiKey` at :105-135), `daytona.ts`
  (`uploadPiAuthToSandbox`, the `!plan.hasApiKey` upload at :126-127, `daytonaEnvVars`),
  `model.ts` (`pickModel`), `daemon.ts` (`buildDaemonEnv` allowlist copy :65-91). `pi.ts` has
  `withRequestProviderEnv` (:74-99, mutates only request.secrets keys) and `pickModel` (:102-112,
  silent fallback). The local overlay is `Object.assign(env, plan.secrets)` (`sandbox_agent.ts`).
- `CustomProviderDTO`: `url`/`version`/`key`/`extras` are nested in `CustomProviderSettingsDTO`,
  not direct fields. `provider_slug` is filled from `header.name`
  (`api/oss/src/core/secrets/dtos.py`). `VaultService` (core/secrets/services.py) exposes
  `list_secrets(project_id, organization_id)` etc.; vault router uses `request.state.project_id`.

**Sibling projects have NOT landed code (confirmed):**

- `sdks/python/agenta/sdk/agents/capabilities.py` does NOT exist. `HarnessCapabilities` in
  `dtos.py:96` has only boolean feature flags (no `providers`/`connection_modes`). No `/inspect`.
  -> This project creates the minimal capability table + entries the resolver needs and notes the
  dependency on harness-capabilities for the full mechanism/`/inspect`.
- `AGENTA_AGENT_MODEL_STRICT` does NOT exist; the Pi `auth.json`/`models.json` per-run
  *generation* is NOT implemented (only copy infra in `sandbox_agent/pi-assets.ts`). -> PR 4 ships
  the env-injection path (in-process Pi + ACP/Daytona env + clear-then-apply) and the
  `runtime_provided` gating, and NOTES the custom-endpoint-on-Pi write as a model-config
  dependency. We add the `_PROVIDER_ENV_VARS` `together_ai` consideration cautiously (model-config
  owns the Together env-var fix; we leave it unless it blocks resolution).

## Slices for this run (smallest shippable, each reviewed + tested)

- **Slice 1 (PR1):** SDK neutral types (`ModelRef`/`Connection`/`Endpoint`/`ResolvedConnection`/
  `RuntimeAuthContext`), the `ConnectionResolver` Protocol + `Env`/`Static` adapters in a new
  `connections/` module, `AgentConfig.model`/`HarnessAgentConfig.model` accept the structured ref
  (bare-string + `"provider/model"` coercion), `SessionConfig.resolved_connection` with `secrets`
  alias, and the wire non-secret fields on both sides + golden updates. No behavior change.
- **Slice 2 (PR2):** API `GET /vault/connections` (read view) + internal-only
  `POST /vault/connections/resolve` with the deterministic rules + capability reject + audit;
  point `VaultConnectionResolver` at it; delete the dump. Minimal capability table entries.
- **Slice 3 (PR3):** Honor `ModelRef.connection` end to end; thread `RuntimeAuthContext` (project
  from request state) into the resolve in `services/oss/src/agent/app.py`.
- **Slice 4 (PR4):** TS engines consume `ResolvedConnection` (exact model, base_url,
  `runtime_provided`/`none`, clear-then-apply env across `daemon.ts`/`sandbox_agent.ts`/`pi.ts`),
  drop the harness-name guess, gate the Pi auth upload on `runtime_provided`. Custom-endpoint Pi
  write deferred to model-config.
- **Slice 5 (PR5):** Minimal FE form on the agent config, gated by the capability map.

## Progress log

- **Slice 1 DONE + reviewed + green.** New `connections/` module (models/interfaces/errors/
  resolver + tests), `model_ref` threaded into `AgentConfig`/`HarnessAgentConfig` (back-compat
  `model: Optional[str]` preserved; wire byte-identical for string-only configs), wire non-secret
  fields on both sides + `KNOWN_REQUEST_KEYS` guards. Review fixes applied: endpoint sub-keys
  camelCased on both Python (`Endpoint.to_wire()`) and TS (`protocol.ts`); base error renamed
  `ConnectionError`->`AgentConnectionError` (avoids shadowing the builtin); secret-safe
  serialization note on `ResolvedConnection`. Tests: 53 Python (connections+wire) + 7 TS wire +
  tsc clean.
- **Slice 2 DONE + reviewed + green.** API: `core/secrets/connections.py` (pure deterministic
  `resolve_connection` + `ConnectionView`/`ResolvedConnectionResult` + domain exceptions),
  `core/secrets/capabilities.py` (server-authoritative table), `apis/fastapi/vault/models.py`,
  `VaultRouter` gets `GET /vault/connections` + internal-only `POST /vault/connections/resolve`
  (project from request.state, audit log never the key). SDK: `platform/connections.py`
  (`VaultConnectionResolver`, fail-loud), `resolve_connection` entrypoint, `capabilities.py`
  (FE/standalone copy). Old whole-vault dump kept-but-deprecated (Slice 3 removes its call site).
  Review fixes applied: (1) routes registered at `/vault/connections...` so the served path
  matches the SDK/design (was `/api/connections`, would 404 in Slice 3); (2) azure/bedrock/vertex
  custom providers now FAIL LOUD (`UnsupportedDeployment` -> 422) instead of silently dropping the
  key (v1 does not wire cloud credential delivery; owned by model-config). Tests: API 20 passed
  (incl new fail-loud), SDK agents 267 passed, ruff clean both sides.
  Deferred/noted (NTH): cross-side test asserting the 3 `_PROVIDER_ENV_VARS` copies stay equal;
  plan.md says "delete the dump" but we keep-deprecate it for Slice 3 (reconcile in docs phase).
- **Slice 3 DONE + reviewed + green.** `services/oss/src/agent/app.py` `_agent()` now builds a
  `ModelRef` from the config (`model_ref` or `coerce(model)`), a `RuntimeAuthContext(harness,
  backend, project_id=None)` (server binds project from auth), calls `resolve_connection`, and
  feeds `resolved.env`->`SessionConfig.secrets` + `resolved_connection`. Graceful degradation:
  `mode=agenta` fails loud on resolution error; `mode=default`/`self_managed` and vault-outage
  degrade to empty env (harness uses own login) — byte-equivalent to the old best-effort dump, so
  no today-working run crashes. The whole-vault dump call site is gone. Tests: 24 service-agent
  unit (20 existing + 4 new) passing; reviewer: no required fixes, all 3 security/behavior
  verdicts confirmed. NOTE: a pre-existing breakage (15 `install_http` integration tests red from
  the earlier PlatformConnection refactor removing `agenta_api_base`/`request_authorization`
  seams) is NOT mine and is logged in scratch/open-issues.md. NOTE: `services/oss/src/agent/
  schemas.py` in the working tree carries sibling skills-config/capability-config defaults
  (`_DEFAULT_SKILL_SLUG`, `sandbox_permission`) — left UNASSIGNED, not a connection change.
- **Slice 4 DONE + reviewed + green.** Python: `HarnessAgentConfig.resolved_connection` +
  `wire_resolved_connection()` (emits provider/exact-model/deployment/credentialMode/endpoint,
  never env; golden byte-identical when absent), threaded via harnesses.py + wire.py. TS:
  clear-then-apply provider env on managed runs (`KNOWN_PROVIDER_ENV_VARS` + `buildDaemonEnv`
  clearProviderEnv + `pi.ts withRequestProviderEnv` snapshot/clear/apply/restore), OAuth upload
  gated on `shouldUploadOwnLogin` (never uploads on credentialMode=env), Claude `ANTHROPIC_BASE_URL`
  from endpoint.baseUrl, harness-name provider guess dropped as the auth driver. Pi custom-endpoint
  write DEFERRED to model-config (logged, not silently dropped); bedrock/vertex Claude env stubbed
  (Slice 2 fails loud first). Tests: 148 TS (+ leak/upload/base_url) + 283 Python agent (excluding
  sibling-broken skills_e2e). Reviewer: no required fixes; all 3 security verdicts confirmed
  (no leak, no env loss, no managed-run upload, golden byte-identical, no secret on wire).
  NOTE: shared working tree has sibling churn — untracked `skills/test_skills_e2e.py` collection
  ImportError (skills-config) and a `disposition` field on `tools/models.py`; both UNASSIGNED, not
  mine. Defer-todo candidate: delete `harnessKeyVar` once all callers send credentialMode.
- **Slice 5 DONE + reviewed + fixed + green.** FE: new
  `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils.ts` (pure
  helpers `modelIdFromConfig`/`connectionFromConfig`/`composeModelValue` + static per-harness
  capability map mirroring SDK `capabilities.py`), and a Connection sub-form in
  `AgentConfigControl.tsx` (provider field, connection-mode select, agenta slug field, raw-JSON
  escape hatch), gated by the harness map. Default-string model stays byte-identical; non-default
  writes the structured `{provider, model, connection:{mode, slug?}}` the backend coerces.
  Review fixes applied: (1) `composeModelValue` now carries through extra ModelRef keys (params,
  ...) so a form edit never drops them; (2) inline "connection name required" guard when
  mode=agenta + empty slug (backend rejects it). Tests: 18 helper tests pass; my files lint+tsc
  clean. NOTE: 9 eslint unused-import errors in `AgentConfigControl.tsx` are sibling
  capability-config churn (ClaudePermissionsControl/SandboxPermissionControl/CaretDown/...), NOT
  mine — left UNASSIGNED. Deferred: live slug picker from `GET /vault/connections` pending a Fern
  client regen (free-text + TODO for now).

## Implementation complete

All 5 slices implemented, reviewed, and green. Remaining: docs (Phase 5) + GitButler lane
(Phase 6, this feature's files only, siblings left unassigned). Live feature-matrix verification
deferred (headless run; the env/harness/key matrix needs a running stack + vault keys).

## Decisions

- **Model intent and its credential connection are one portable `ModelRef` in the agent config.**
  The connection is `default` / `self_managed` / `agenta`+`slug`, where `slug` is a secret name,
  never a database id. The connection always rides the config; there is no separate run-level
  override (a test invoke sends the config inline).
- **The connection is a portable logical binding, not a physical-account guarantee.** A named
  connection resolves per project by name; the resolved slug is recorded on every run.
- **The existing vault is the one credential store for v1.** A vault secret is a connection
  (`provider_key` = direct; `custom_provider` = a connection with an endpoint). v1 adds a read list
  and a resolve; no new storage, no migration, no `/secrets` change.
- **Resolution is deterministic and explicit.** Named slug must be present and unambiguous; default
  means exactly-one-connection or a uniquely-named `default`, else error. Never pick by iteration
  order. Provider must match. The vault has no default flag and non-unique names today, so the
  resolver enforces uniqueness at read time and errors on collision.
- **One injected credential, least privilege.** Replaces the whole-vault dump
  (`sdks/python/agenta/sdk/agents/platform/secrets.py:105-141`).
- **`env` is the only secret channel.** The endpoint carries only non-secret config; secret-bearing
  custom-provider values go into `env`.
- **The resolve endpoint is internal-only**, not a browser-callable secret reader.
- **Self-managed covers OAuth subscriptions**; Agenta injects nothing. Managed OAuth is deferred.
- **The prompt/completion path is untouched.** It keeps its own LiteLLM reader of the same vault. A
  shared resolution core is a later follow-up, not v1.
- **Provider/connection capabilities are two entries in the harness-capabilities table**, not a new
  mechanism here; the backend rejects an unsupported provider/mode server-side.
- **Frontend is a minimal form** exposing the variables directly, plus a raw-JSON escape hatch.

## Open decisions (do not block v1)

- Where a durable per-environment default connection lives for a deployed agent (changes what
  `mode: default` resolves to; the config-stored path is unaffected).
- User-facing term: "Connection" is the working choice; whether to rename the legacy
  "Provider key / Custom provider" settings labels in the same pass or later.

## Risks flagged

- Secret names (`Header.name`) are nullable, mutable, and not unique today
  (`api/oss/src/dbs/postgres/secrets/mappings.py`). The resolver enforces uniqueness at read time;
  a storage uniqueness constraint is a follow-up.
- Duplicate keys for one provider behave differently across the two existing readers (agent path
  first-wins `platform/secrets.py:140`; completion path last-wins `managers/secrets.py:219`). v1
  resolve forces an explicit choice.
- Inherited provider env must be cleared before applying the resolved plan on managed runs
  (`services/agent/src/engines/sandbox_agent/daemon.ts`, `sandbox_agent.ts`, `pi.ts`).
- `AGENTA_CRYPT_KEY` defaults to `"replace-me"` (`api/oss/src/utils/env.py:410`). Out of scope.

## Next steps

1. Implement the 5-PR stack in [plan.md](plan.md), starting with PR 1 (neutral types, no behavior
   change).
2. Land each PR green with the tests in the plan's test strategy.
3. Verify on the live feature-matrix harness (two OpenAI connections, a custom base_url, a
   self-managed run).
