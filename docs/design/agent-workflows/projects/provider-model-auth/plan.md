# Plan

A stacked PR plan for v1. Each PR is reviewable on its own, lands green, and does not regress
current behavior until the slice that intentionally replaces it. Names follow [design.md](design.md):
`ModelRef` (with `connection`), `Connection`, `ResolvedConnection`, `ConnectionResolver`.

## Scope guardrails

- No new credential storage model, write path, or CRUD. Connections are a read view over the
  existing `secrets` table; writes stay on the existing `/secrets` UI/API.
- No storage migration, no change to the vault encryption column or the `/secrets` API.
- No prompt/completion-path migration, no managed OAuth, no first-class cloud identity beyond
  today's custom `extras`.
- No new capability-table mechanism; v1 adds two entries to the
  [../harness-capabilities/](../harness-capabilities/) table.

## Coordination with sibling projects

- [../model-config/](../model-config/) owns the Pi `auth.json`/`models.json` write into the per-run
  agent dir, the `_PROVIDER_ENV_VARS` Together fix, and the staged `AGENTA_AGENT_MODEL_STRICT`
  rollout. PR 4 here consumes that write (choosing which connection feeds it) and follows the staged
  strict rollout rather than flipping strict immediately.
- [../harness-capabilities/](../harness-capabilities/) owns the static table, `/inspect`, and FE
  gating. PR 2 adds the `providers`/`connection_modes` entries and the backend reject; PR 5 consumes
  them in the form.

## PR 1: Neutral types and the resolver port (no behavior change)

- Add `ModelRef` (with `connection`, `"provider/model"` and bare-string coercion) and wire it into
  `AgentConfig.model` and `HarnessAgentConfig.model` (`sdks/python/agenta/sdk/agents/dtos.py`).
- Add `Connection` (`default` / `self_managed` / `agenta`+`slug`), `Endpoint`, `ResolvedConnection`,
  and `RuntimeAuthContext`. Put `resolved_connection` on `SessionConfig`, keeping `secrets` as a
  compatibility alias for its `env`.
- Add the `ConnectionResolver` Protocol, `EnvConnectionResolver`, and `StaticConnectionResolver` in
  a new `sdks/python/agenta/sdk/agents/connections/` module (reuse the sdk-local-tools
  `SecretResolver` pattern).
- Add the non-secret contract fields (`provider`, `connection`, `deployment`, `endpoint`,
  `credential_mode`) to the `/run` wire on both sides and update golden tests (`utils/wire.py`,
  `services/agent/src/protocol.ts`).
- The service still produces today's env map, now through the resolver shape. No new endpoint.

**Acceptance:** existing agent and wire golden tests pass unchanged in meaning; `ModelRef`
round-trips `"openai/gpt-5.5"`, `"gpt-5.5"`, and a full object with a connection; a standalone run
with `OPENAI_API_KEY` in env resolves a plan carrying just that var via `EnvConnectionResolver`.

## PR 2: Service resolve over the vault, least-privilege, capability reject

- Add `GET /vault/connections`: a read list projecting existing `provider_key` and
  `custom_provider` secrets into connection views (slug, provider, deployment, endpoint). Never
  returns key material.
- Add `POST /vault/connections/resolve`: takes `{model}` + the auth context, scopes to
  `context.project_id`, returns one `ResolvedConnection`. **Internal-only**: not mounted as a
  browser-callable vault API; uses internal service auth or stays inside server-side agent plumbing
  (the existing `GET /secrets/` already returns key material, so do not follow that mounting).
- Implement the deterministic resolution rules from [design.md](design.md): self_managed; named slug
  (missing -> error, ambiguous duplicate -> error); default (exactly-one, or uniquely-named
  `default`, else error); provider match. Never pick by iteration order.
- Add the `providers`/`connection_modes` capability entries and make resolve reject a provider or
  mode outside the selected harness's entry (fail-loud, server-side).
- Point `VaultConnectionResolver` at the endpoint. Delete the dump in `resolve_provider_keys`
  (`sdks/python/agenta/sdk/agents/platform/secrets.py`) and the `services/oss/src/agent/secrets.py`
  re-export. Include `custom_provider` connections (the dump ignores them today).

  *Implementation note (2026-06-24):* to keep each slice green, the dump function
  (`resolve_provider_keys`/the `secrets.py` re-export) is kept-but-deprecated in PR 2 and its
  live CALL SITE in `services/oss/src/agent/app.py` is removed in PR 3 (which is what actually
  swaps the running path onto `resolve_connection`). Fully deleting the now-unused function is a
  trivial follow-up once no test imports it (the stale `install_http` integration test still
  references it; see scratch/open-issues.md).
- Audit each resolve (provider, model, slug, mode, user, project; no key).

**Acceptance:** two OpenAI connections coexist and resolve by slug; a run injects exactly one key; a
`custom_provider` connection resolves with its `base_url`; `GET /secrets/` is no longer called on
the agent path; an absent slug, an ambiguous slug, a provider mismatch, and an unsupported
provider/mode for the harness each return a clear error; `mode: default` with two unnamed
connections errors.

## PR 3: Honor the config-stored connection

- Make resolution honor `ModelRef.connection`: `default`, `self_managed`, `agenta`+`slug` per the
  rules, fail-loud as specified.
- Thread `ModelRef.connection` and a populated `RuntimeAuthContext` (project from request context,
  harness, backend) into the resolver call in `services/oss/src/agent/app.py`. The connection
  arrives inside `parameters` (the config the handler already receives); no new request field.
- Reject any attempt to pass a project id through the body; resolve from request context only.

**Acceptance:** a committed revision carries a portable `connection` and resolves per project; a test
invoke that sends the config inline with a different connection uses exactly that; reusing a revision
in a project missing the slug fails loud; `self_managed` injects nothing.

## PR 4: Harness and runner consume ResolvedConnection

- `adapters/harnesses.py`: build harness config from `ModelRef` + `ResolvedConnection`.
- TS engines: apply `provider`+`model` exactly, apply `endpoint.base_url`, honor
  `runtime_provided`/`none` (inject nothing), and clear all known provider env before applying the
  resolved `env` on managed runs (fix the inherited-env copy in `sandbox_agent/daemon.ts`, the
  request-secrets overlay in `sandbox_agent.ts`, and the present-keys-only mutation in `pi.ts`).
  Drop the `acpAgent === "claude" ? ... : ...` provider guess.
- Gate Pi's OAuth `auth.json` upload behind `runtime_provided`, not the old `hasApiKey` guess.
- Custom endpoint delivery: Pi `registerProvider` / `models.json` (via the model-config Part 1
  write, fed by this connection); Claude `ANTHROPIC_BASE_URL` (+ `CLAUDE_CODE_USE_*` for
  bedrock/vertex). Codex translation lands with the Codex harness if/when it exists; stub and note.
- Model strictness: follow model-config's staged `AGENTA_AGENT_MODEL_STRICT` rollout. Do not flip
  strict-fail on by default in this PR (the playground sends a default model on every run); ship the
  exact-resolution path and the clearer error behind the flag, default off, per model-config.

**Acceptance:** a custom OpenAI-compatible base_url runs on Pi; `runtime_provided` runs with no
injected key and uses the harness login; the resolved `env` is the only provider env present on a
managed run (no inherited key leaks through).

## PR 5: Minimal frontend (form-like)

- A form on the agent config that exposes the variables directly: a provider selector, a model
  field, the `params` map, a connection-mode control (Use an Agenta connection / Project default /
  Self-managed), and a connection-slug picker fed by `GET /vault/connections` when "Agenta
  connection" is chosen. Plus a raw-JSON escape hatch for the exact `ModelRef`.
- Gate the provider list and the connection-mode options against the harness-capabilities map for
  the selected harness (hide what the harness cannot reach).
- No redesign of the rest of the playground. Adding a connection stays on the existing secrets UI.

**Acceptance:** a user picks a provider, model, and connection, or toggles self-managed, or pastes
JSON, and the run uses exactly that; the form hides providers/modes the selected harness cannot
reach.

## Cross-cutting: trace which connection ran

Record the resolved connection slug and credential mode on the workflow span (never the key), so a
run is reproducible and an operator can see which connection paid. Land with PR 2.

## Test strategy

- SDK unit: `ModelRef`/`Connection` coercion and the union, `ResolvedConnection`/`Endpoint` shape,
  `EnvConnectionResolver`, `StaticConnectionResolver`.
- Wire golden: the new non-secret fields on both Python and TS sides, in the same PR.
- API unit: the connection read view; the resolve for direct, custom, and self-managed; the
  deterministic rules (absent slug, ambiguous slug, default exactly-one vs named vs error, provider
  mismatch); project-scope and harness-capability rejections; resolve is not browser-callable.
- Service unit: `VaultConnectionResolver` against an httpx-mocked resolve endpoint; least-privilege
  (only the selected provider's vars come back).
- Engine (vitest): contract application for Pi and Claude, including `runtime_provided`/`none`,
  clear-then-apply env, exact model resolution.
- Live acceptance (manual, existing feature-matrix harness): two OpenAI connections, a custom
  base_url, and a self-managed (OAuth) run. See [../feature-matrix-test.md](../feature-matrix-test.md).

## Follow-ups (not in this stack)

- First-class `Connection` storage with a uniqueness constraint and an explicit default flag; CRUD.
- Migrate the prompt/completion path onto a shared resolution core; retire its dedup-shadow
  (`sdks/python/agenta/sdk/managers/secrets.py:219`).
- Managed OAuth; first-class Bedrock/Vertex identity.
- A durable per-environment default connection for a deployed agent.
- Cost/usage attribution per connection, audit surface, key rotation and revoked state, team/org
  scope.
- Encryption hardening: replace the `"replace-me"` `AGENTA_CRYPT_KEY` default.
