# Design

How an agent harness picks its provider and model and gets exactly one credential injected. The
plain-language version is in [explainer.md](explainer.md); the codebase findings are in
[research.md](research.md); the work is sliced in [plan.md](plan.md).

## The shape in one paragraph

Model intent and its credential connection live together in one `ModelRef` in the agent config. A
connection is a portable reference (a project default, self-managed, or a named connection) into
the existing secret vault, never a database id and never a raw secret. A `ConnectionResolver`
reads one connection from the vault and returns one least-privilege `ResolvedConnection` (env vars
plus a non-secret endpoint) that the harness adapter applies. The vault is the one credential
store; v1 adds a read view and a resolve over it, and changes no storage. Which providers and
connection modes a harness can reach is declared in the harness-capabilities table, and the
resolver rejects anything outside it.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ModelRef (in the agent config, committed and portable)                    │
│   { provider, model, params, connection }                                 │
│   connection = default | self_managed | { agenta, slug }                  │
│   a slug, never a project-local id; no secret value                       │
└───────────────┬───────────────────────────────────────────────────────────┘
                │  a test invoke sends this config inline; a committed
                │  revision carries it. The connection is always in the config.
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ConnectionResolver.resolve(model, ctx) -> ResolvedConnection              │
│   ctx = { project (from request context), harness, backend }              │
│   reads ONE connection from the existing vault; no new store              │
└───────────────┬───────────────────────────────────────────────────────────┘
                │  ResolvedConnection { provider, model, deployment,
                │    credential_mode, env, endpoint }   (env = only secret channel)
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Harness adapter (Pi / Codex / Claude)                                     │
│   applies env + endpoint + model; never sees a vault, connection, or slug │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Concern 1: ModelRef in the agent config

`AgentConfig.model` becomes a structured ref carrying model intent and the credential connection.
A bare string still parses, with the default connection.

```python
class ModelRef(BaseModel):
    provider: Optional[str] = None   # logical family: "openai" | "anthropic" | "google" | <custom-slug>
    model: str                       # model id in that provider's namespace: "gpt-5.5", "claude-opus-4-8"
    params: Dict[str, Any] = {}      # neutral knobs all harnesses understand: reasoning_effort, ...
    connection: Connection = Connection()   # where the credential comes from

    # "openai/gpt-5.5" -> ModelRef(provider="openai", model="gpt-5.5", connection=default)
    # "gpt-5.5"        -> ModelRef(provider=None, model="gpt-5.5", connection=default)
```

`provider` is logically required for resolution. When it is absent (a bare-string `model`), the
resolver infers it from the model id or from the matched connection, and errors if it cannot. The
committed revision carries the whole `ModelRef`, including the connection.

```python
class Connection(BaseModel):
    mode: Literal["default", "self_managed", "agenta"] = "default"
    slug: Optional[str] = None   # required iff mode == "agenta"; the secret's name, never a db id
```

- `default`: use the project's connection for `provider` (resolution rules below). Names nothing
  project-local. This mirrors how a prompt resolves its key today.
- `self_managed`: Agenta injects nothing. The sandbox, sidecar, local backend, local SDK env, or
  the harness's own OAuth login owns auth. Names nothing project-local. Covers OAuth subscriptions
  and self-hosting.
- `agenta` + `slug`: use the named connection in the project vault.

### The connection is a portable logical binding, not a physical-account guarantee

A stored connection names a role, like "this project's `openai-prod` connection." On reuse in
another project the slug resolves against that project's vault by name, to that project's
`openai-prod`. A credential value is a project-scoped secret and never travels with the revision.

This is the right behavior for "use my prod OpenAI connection," with one limit stated plainly: if
two projects both have an `openai-prod` connection but holding *different* OpenAI accounts, the
slug resolves to each project's own account. That is by-name-correct but a different physical
account than the origin project's, and the provider-match rule does not catch it because both are
OpenAI. We accept that, and we record the resolved slug on every run (Security, rule 7) so an
operator can always see which connection paid. Guaranteeing that an exported revision keeps using
the exact origin account would require a cross-project credential identity, which is out of scope.

There is no separate run-level override. The agent invoke handler already receives the config in
`parameters` (`services/oss/src/agent/app.py`), so testing a different connection for one run is
just sending a different `connection` in the config you test, the same way any config is tested
before it is committed.

---

## Concern 2: a connection is a vault secret (reuse, no new store)

The vault already stores connections, so v1 reuses it. No new storage model, no write path, no
migration, no `/secrets` change.

- A `provider_key` secret is a **direct** connection: `slug` from the secret name, `provider` from
  `data.kind`, credential from `data.provider.key` (`api/oss/src/core/secrets/dtos.py:17-23`).
- A `custom_provider` secret is a connection that **already carries an endpoint**: base URL,
  version, extras, a `models[]` list, and a `provider_slug` from the secret name
  (`api/oss/src/core/secrets/dtos.py:38-45`, `:225-230`). It maps cleanly to Pi's
  `registerProvider({ baseUrl, apiKey, models })` and Claude's `ANTHROPIC_BASE_URL`.

We add a read list and a resolve over these secrets. Creating and editing connections stays on the
existing secrets UI and API.

The prompt/completion path keeps its own reader (`SecretsManager.get_provider_settings`,
`sdks/python/agenta/sdk/managers/secrets.py:158`), which produces LiteLLM kwargs and does a
custom-provider model rewrite. v1 does **not** couple the agent path to that code. Both read the
same vault; they are independent readers. Unifying them onto one shared core later (so a user
configures a connection once) is a separate follow-up, not v1.

### Self-managed credentials (OAuth)

Claude, Codex, and Pi all rewrite their OAuth credential file at run time when the token rotates
([research.md](research.md), Part 2.3). A frozen copy in the vault goes stale, and a vault snapshot
cannot be written back to the user's login store. So we never store the rotating file:
`connection.mode = self_managed` resolves to `credential_mode = runtime_provided`, and Agenta
injects nothing. Managed OAuth (a stored refresh token minted through each harness's
credential-helper hook) is deferred.

---

## Concern 3: ResolvedConnection and the resolver port

```python
class ResolvedConnection(BaseModel):
    provider: str
    model: str                     # possibly rewritten for the deployment (e.g. a bedrock id)
    deployment: str = "direct"     # "direct" | "azure" | "bedrock" | "vertex" | "custom"
    credential_mode: Literal["env", "runtime_provided", "none"]
    env: Dict[str, str] = {}       # the ONLY secret-bearing channel; one provider's vars
    endpoint: Optional[Endpoint] = None   # NON-secret only: base_url, api_version, region, public headers
```

`env` is the only channel that carries secret values. The `custom_provider` secret's `key` and any
secret-bearing `extras` (auth tokens, secret headers) are projected into `env`, never into
`endpoint`. `endpoint` carries only non-secret connection config.

`SessionConfig` gains `resolved_connection`. The existing `secrets` field
(`sdks/python/agenta/sdk/agents/dtos.py:583`) stays as a compatibility alias for `env` during the
transition.

```python
class RuntimeAuthContext(BaseModel):
    project_id: UUID         # from request.state, never from the request body
    harness: str             # "pi" | "claude" | "codex"; for the capability check
    backend: Optional[str] = None   # sandbox-agent local / daytona / in-process / local SDK

class ConnectionResolver(Protocol):
    async def resolve(self, *, model: ModelRef, context: RuntimeAuthContext) -> ResolvedConnection: ...
```

The context carries the harness (and backend) so the resolver can reject a provider or connection
mode the selected harness cannot reach (Concern 3b). Adapters:

- `VaultConnectionResolver` (service): calls `POST /vault/connections/resolve`, scoped to
  `context.project_id`, returning one `ResolvedConnection`. Replaces the whole-vault dump in
  `resolve_provider_keys` (`sdks/python/agenta/sdk/agents/platform/secrets.py:105-141`).
- `EnvConnectionResolver` (SDK default, standalone): reads `OPENAI_API_KEY` etc. from the process
  env for the requested provider. Offline.
- `StaticConnectionResolver` (SDK bring-your-own): the SDK user passes a credential at
  instantiation.

### Resolution rules (deterministic; no `is_default` field exists in v1)

The vault has no default flag, and secret names are not unique today, so resolution must be
explicit, not a guess:

1. `mode == self_managed` -> `credential_mode = runtime_provided`, empty `env`. Done.
2. `mode == agenta` with no `slug` -> error (a named connection must name one).
3. `mode == agenta` with `slug` -> the connection whose name equals `slug` for `provider`. If none
   exists -> error ("connection `<slug>` not found"). If more than one matches
   `(project, provider, slug)` -> error (ambiguous; names must be unique to resolve).
4. `mode == default` -> if exactly one connection exists for `provider`, use it. Else if exactly
   one connection for `provider` is named `default`, use it. Else -> error ("multiple connections
   for `<provider>`; name one in the config"). Multiple unnamed legacy keys for one provider are
   ambiguous and error the same way.
5. **Provider match.** The resolved connection's provider must equal `ModelRef.provider`. Reject a
   mismatch.

These rules never silently pick a key by iteration order, which is what the two existing readers do
differently today (agent path first-wins, `platform/secrets.py:140`; completion path last-wins,
`managers/secrets.py:219`). Uniqueness of `(project, provider, name)` is not enforced by storage in
v1; the resolver enforces it at read time and errors on a collision. (A future storage migration can
add a uniqueness constraint and an explicit default flag; out of scope here.)

### How each harness consumes the contract

The harness adapter (`adapters/harnesses.py` plus the TS engines) applies `ResolvedConnection`. It
never sees a vault, a connection, or a slug.

| Contract field | Pi | Codex | Claude Code |
| --- | --- | --- | --- |
| `provider` + `model` | `getModel(provider, id)` then `createAgentSession({ model })`; exact match | `model` + `model_provider` | `--model` / `ANTHROPIC_MODEL`; provider via flags below |
| `env` (api key) | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / ... or `AuthStorage.setRuntimeApiKey` | `OPENAI_API_KEY` or the provider block's `env_key` | `ANTHROPIC_API_KEY` |
| `endpoint.base_url` | `Model.baseUrl` / `registerProvider({ baseUrl })` | `[model_providers.<id>].base_url` | `ANTHROPIC_BASE_URL` |
| `deployment` azure/bedrock/vertex | provider `azure-openai-responses` / `amazon-bedrock` / `google-vertex` + creds | `model_providers` base_url + `query_params` + AWS/GCP env | `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` + AWS/GCP env |
| `credential_mode = runtime_provided` | inject nothing; do not upload a fallback `auth.json`; harness uses its own login | inject nothing; uses `~/.codex/auth.json` | inject nothing; uses `.credentials.json` / inherited `CLAUDE_CODE_OAUTH_TOKEN` |
| `credential_mode = none` | inject nothing | inject nothing | inject nothing |

For Pi, the `env` + `endpoint` are written into the per-run agent dir as `auth.json`/`models.json`
by the mechanism [../model-config/](../model-config/) Part 1 owns. This project chooses which
connection feeds that write.

---

## Concern 3b: which providers and connection modes a harness allows

The frontend needs to know each harness's reachable providers and credential modes (Claude is
narrow: Anthropic via direct/Bedrock/Vertex; Pi is broad). That table mechanism lives in the
[../harness-capabilities/](../harness-capabilities/) project (a static per-harness table in
`sdks/python/agenta/sdk/agents/capabilities.py`, exposed on `/inspect`, cross-referenced by the
frontend). This project contributes two entries:

- `providers`: the provider families the harness can reach, with allowed `deployment`s.
- `connection_modes`: which `Connection.mode` values and deployments the harness supports (e.g.
  `self_managed` on all three; custom `base_url` on all three, but Codex needs it in global
  config; `self_managed` may be marked unavailable on a managed-cloud backend).

The resolver and backend **reject** a `ModelRef` whose provider or connection mode is outside the
selected harness's entry, fail-loud, using `context.harness`/`context.backend`. This rejection lands
with the resolver behavior (server-side), not only in the frontend, so a direct API caller is also
guarded.

---

## Security non-negotiables

1. **Project from the request context, never the body.** Resolve by
   `(context.project_id, provider, slug)`.
2. **Provider match.** The resolved connection's provider must equal `ModelRef.provider`.
3. **Resolve is internal service plumbing, not a browser secret reader.**
   `POST /vault/connections/resolve` returns plaintext credentials in `env`. It must not be mounted
   as a browser-callable vault API. Note the existing `GET /secrets/` (`list_secrets`,
   `api/oss/src/apis/fastapi/vault/router.py`) already returns key material in
   `SecretResponseDTO`; the resolve must use internal service auth or stay inside server-side agent
   plumbing, not follow that pattern.
4. **No secret values in logs, traces, errors, or the raw-JSON playground echo.** Traces carry
   provider, model, deployment, and the resolved connection slug. Never `env`.
5. **Clear-then-apply env on managed runs.** The runner clears all known provider env vars it would
   otherwise inherit, then applies only the resolved `env`. Today the runner copies inherited
   provider env (`services/agent/src/engines/sandbox_agent/daemon.ts`) and overlays request secrets
   (`services/agent/src/engines/sandbox_agent.ts`), and in-process Pi only mutates the keys present
   in `request.secrets` (`services/agent/src/engines/pi.ts`); none of these clears the full known
   set first. Fix all three.
6. **`self_managed` gates off the OAuth fallback.** `credential_mode = runtime_provided` injects
   nothing and must not upload Pi's fallback `auth.json`.
7. **Audit every resolve**: provider, model, connection slug, credential mode, user, project. Never
   the key material.
8. **Flagged, not fixed here.** `AGENTA_CRYPT_KEY` defaults to `"replace-me"`
   (`api/oss/src/utils/env.py:410`). Tracked as a follow-up.

---

## Multi-account, end to end

1. A project holds two OpenAI connections in the vault, named `openai-prod` and `openai-dev` (two
   `provider_key` secrets).
2. The config sets `model: { provider: openai, model: gpt-5.5, connection: { mode: agenta, slug:
   openai-prod } }`. The committed revision carries that, portably (slug, not id). To test against
   `openai-dev` for one run, send the config inline with `connection.slug = openai-dev`; nothing new
   is committed.
3. `VaultConnectionResolver.resolve` looks up `(project, provider=openai, slug=openai-prod)` and
   returns `{ credential_mode: env, env: { OPENAI_API_KEY: <prod key> }, model: gpt-5.5 }`.
4. The harness adapter injects that one key. The other connection, and every other provider's key,
   never enters the run.

With `mode: default` and a single OpenAI connection, the run uses it. With two OpenAI connections
and neither named `default`, `mode: default` errors and asks the config to name one. With
`mode: self_managed`, the resolver returns `runtime_provided` and injects nothing.

---

## Relationship to the sibling projects

- [../model-config/](../model-config/): makes a requested model settable on each harness (the Pi
  `auth.json`/`models.json` write into the per-run agent dir, fail-loud on an unsettable model,
  model choices in the schema, the `_PROVIDER_ENV_VARS` Together fix). This project decides which
  connection's credential that write uses; model-config owns the write and the staged strict-model
  rollout (`AGENTA_AGENT_MODEL_STRICT`).
- [../harness-capabilities/](../harness-capabilities/): the capability-table mechanism. This project
  contributes the `providers` and `connection_modes` entries.
- [../capability-config/](../capability-config/): the three permission layers (harness config,
  sandbox permission, tool permission). Orthogonal to credentials.

---

## Deferred (out of scope for v1)

- A first-class `Connection` storage model with a uniqueness constraint and an explicit default
  flag, a write path, and CRUD endpoints.
- Migrating the prompt/completion path onto a shared resolution core.
- Managed OAuth (stored refresh token plus credential-helper minting).
- First-class cloud identity beyond today's custom `extras` (Bedrock/Vertex). *v1 implementation
  note:* a `custom_provider` connection whose deployment is azure/bedrock/vertex resolves to a
  fail-loud `UnsupportedDeployment` error (422) rather than silently dropping the key, since v1
  does not wire cloud credential delivery (AWS/GCP env, `CLAUDE_CODE_USE_*`). Direct and
  OpenAI-compatible custom endpoints are the v1 surfaces.
- A durable per-environment default connection for a deployed agent.
- Cost/usage attribution per connection, audit surface, key rotation, revoked state, team/org scope.
- Cross-project credential identity (the exact-origin-account guarantee).
- Encryption hardening (replace the `"replace-me"` `AGENTA_CRYPT_KEY` default).

---

## What changes, by file

- SDK DTOs and port: `ModelRef` (with `connection`), `Connection`, `ResolvedConnection`,
  `Endpoint`, `RuntimeAuthContext`, the `ConnectionResolver` Protocol, `EnvConnectionResolver`,
  `StaticConnectionResolver` (`sdks/python/agenta/sdk/agents/dtos.py:324,419,583`, `interfaces.py`,
  a new `connections/` module). Bare-string `model` coercion.
- Wire: add the non-secret fields (`provider`, `connection`, `deployment`, `endpoint`,
  `credential_mode`) to the `/run` contract on both sides
  (`sdks/python/agenta/sdk/agents/utils/wire.py`, `services/agent/src/protocol.ts`) with golden-test
  updates in one PR.
- Service/API: `VaultConnectionResolver`; new `GET /vault/connections` (read list over existing
  secrets) and `POST /vault/connections/resolve` (internal-only); delete the dump in
  `resolve_provider_keys` (`sdks/python/agenta/sdk/agents/platform/secrets.py`) and its re-export
  (`services/oss/src/agent/secrets.py`); the deterministic resolution rules; include
  `custom_provider` connections (`api/oss/src/apis/fastapi/vault/`, `api/oss/src/core/secrets/`).
- Resolution wiring: thread `ModelRef.connection` plus `RuntimeAuthContext` into the resolver call
  in `services/oss/src/agent/app.py`. The connection rides `parameters`; no new request field.
- Capability entries: `providers` and `connection_modes` in
  `sdks/python/agenta/sdk/agents/capabilities.py`, with the resolver/backend reject.
- TS engines: apply `ResolvedConnection` (exact model, `endpoint.base_url`, `runtime_provided`/
  `none`, clear-then-apply env); drop the harness-name->provider guess
  (`services/agent/src/engines/pi.ts`, `sandbox_agent.ts`). Pi `auth.json`/`models.json` write
  coordinated with model-config Part 1.
- Frontend: a form on the agent config that exposes provider, model, params, connection mode, and
  connection slug directly, plus a raw-JSON escape hatch, gated by the harness-capabilities map.
