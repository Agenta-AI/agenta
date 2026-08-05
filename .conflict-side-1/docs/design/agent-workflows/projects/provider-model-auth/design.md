# Design

How an agent harness picks its provider and model and gets exactly one credential injected. The
plain-language version is in [explainer.md](explainer.md); the codebase findings are in
[research.md](research.md); the work is sliced in [plan.md](plan.md).

## The shape in one paragraph

Model intent and its credential connection live together in one `ModelRef` in the agent config. A
connection is a portable reference (an Agenta connection, either project default or a named one, or
self-managed) into the existing secret vault, never a database id and never a raw secret. The split
of responsibility is the spine of this design: **the API/vault layer just resolves a stored vault
secret into a neutral credential bundle (it is harness-agnostic), and the agent/harness layer owns
all harness knowledge: the provider lists, the connection-mode rules, and the env/flag projection.**
A `ConnectionResolver` reads one connection from the vault and returns one least-privilege
`ResolvedConnection` (env vars plus a non-secret endpoint) that the harness adapter applies. The
vault is the one credential store; v1 adds a read view and a resolve over it, and changes no storage.
Which providers, deployments, and connection modes a harness can reach is a harness-layer artifact:
a SDK capability table that the agent service `/inspect` publishes (in `meta`, not as a schema key)
for the frontend, and that the agent service imports directly for its own server-side check (Concern
3b). The agent layer rejects anything outside it before the vault resolve runs.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ModelRef (in the agent config, committed and portable)                    │
│   { provider, model, params, connection }                                 │
│   connection = { mode: agenta, slug? } | { mode: self_managed }           │
│   a slug, never a project-local id; no secret value                       │
└───────────────┬───────────────────────────────────────────────────────────┘
                │  a test invoke sends this config inline; a committed
                │  revision carries it. The connection is always in the config.
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Agent/harness layer (knows the harness)                                   │
│   PRE-resolve check: ModelRef.provider + connection.mode against the      │
│   harness capability table (imported from the SDK), fail-loud             │
└───────────────┬───────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ConnectionResolver.resolve(model, ctx) -> ResolvedConnection              │
│   ctx = { project (from request context) }                                │
│   reads ONE connection from the existing vault; no new store;             │
│   harness-AGNOSTIC: emits a neutral credential bundle, no harness checks.  │
│   The vault picks deterministically and matches provider only; it does    │
│   not know the harness. deployment (direct/bedrock/...) is only KNOWN here │
│   for a slug-less agenta connection AFTER the secret is selected.          │
└───────────────┬───────────────────────────────────────────────────────────┘
                │  ResolvedConnection { provider, model, deployment,
                │    credential_mode, env, endpoint }   (env = only secret channel)
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Agent/harness layer (knows the harness)                                   │
│   POST-resolve check: the resolved deployment against the harness         │
│   capability table, fail-loud (e.g. Claude + bedrock -> reject)           │
└───────────────┬───────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Harness adapter (Pi / Codex / Claude)                                     │
│   maps the neutral connection to native shape; applies env + endpoint +   │
│   model; never sees a vault, connection, or slug                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Concern 1: ModelRef in the agent config

`AgentConfig.model` becomes a structured ref carrying model intent and the credential connection.
A bare string still parses, with the default Agenta connection.

```python
class ModelRef(BaseModel):
    provider: Optional[str] = None   # logical family: "openai" | "anthropic" | "google" | <custom-slug>
    model: str                       # model id in that provider's namespace: "gpt-5.5", "claude-opus-4-8"
    params: Dict[str, Any] = {}      # neutral knobs all harnesses understand: reasoning_effort, ...
    connection: Connection = Connection()   # where the credential comes from

    # "openai/gpt-5.5" -> ModelRef(provider="openai", model="gpt-5.5", connection={mode: agenta})
    # "gpt-5.5"        -> ModelRef(provider=None, model="gpt-5.5", connection={mode: agenta})
```

`provider` is logically required for resolution. When it is absent (a bare-string `model`), the
resolver infers it from the matched connection — a vault candidate whose model id matches the
bare string. If nothing matches, there is no provider to look a credential up against, so it
fails loud with `MissingProviderError` ("model needs a provider prefix, e.g. `openai/<model>`")
rather than degrading to no-credential and surfacing later as a misleading "add your key" auth
error (F-017). There is deliberately no model-id→provider table (a maintenance burden and a
guess); a bare model id that matches no connection must carry a `provider/` prefix or a
structured `{provider, model}`. The committed revision carries the whole `ModelRef`, including
the connection.

```python
class Connection(BaseModel):
    mode: Literal["agenta", "self_managed"] = "agenta"
    slug: Optional[str] = None   # meaningful only for "agenta"; the secret's name, never a db id
```

There are exactly **two** connection modes:

- `agenta`: use a connection in the project vault. `slug` selects which:
  - **omitted** -> the project's default connection for `provider` (resolution rules below). This
    mirrors how a prompt resolves its key today.
  - **set** -> the named connection whose secret name equals `slug` for `provider`.

  In both cases `agenta` names nothing project-local (a slug is a name, never a db id) so it stays
  portable across projects.
- `self_managed`: Agenta injects nothing. The sandbox, sidecar, local backend, local SDK env, or
  the harness's own OAuth login owns auth. Names nothing project-local. Covers OAuth subscriptions
  and self-hosting.

There is no separate `default` mode: "the project default" is just `agenta` with no slug.
`slug` is meaningful only for `agenta`; a `self_managed` connection that carries a `slug` is rejected
at validation (the slug has nothing to resolve against).

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

## Concern 2: a connection IS a vault secret (no new entity)

State this plainly: **a connection is not a new thing.** A connection IS a vault secret. There is no
new storage, no new table, no write path, no migration, no `/secrets` change. The word "connection"
names two things only: (a) how the agent config references an existing secret (`mode` plus an
optional `slug`), and (b) the resolved projection of that secret (the `ResolvedConnection` below).
Nothing is persisted that does not already exist.

- A `provider_key` secret IS a **direct** connection: `slug` from the secret name, `provider` from
  `data.kind`, credential from `data.provider.key` (`api/oss/src/core/secrets/dtos.py:17-23`).
- A `custom_provider` secret IS a connection that **already carries an endpoint**: base URL,
  version, extras, a `models[]` list, and a `provider_slug` from the secret name
  (`api/oss/src/core/secrets/dtos.py:38-45`, `:225-230`). It maps cleanly to Pi's
  `registerProvider({ baseUrl, apiKey, models })` and Claude's `ANTHROPIC_BASE_URL`.

We add a read list and a resolve over these secrets. Creating and editing connections stays on the
existing secrets UI and API.

### Same secret, different projection (worked example)

The SAME stored secret feeds the model hub and the agent harnesses; only the projection differs. A
Bedrock `custom_provider` secret in the vault is one secret, used three ways:

- **Model hub / completion path**: projected into LiteLLM kwargs (the existing
  `SecretsManager.get_provider_settings` reader).
- **Claude Code**: projected into `CLAUDE_CODE_USE_BEDROCK=1` plus the AWS env group (v1: declared
  but not wired, fail loud).
- **Pi**: projected into the `amazon-bedrock` provider plus the AWS env group.

No new secret is created for the agent path. The agent layer reads the same vault entry and projects
it per harness. The full credential set for each complex provider is in
[harness-provider-matrix.md](harness-provider-matrix.md).

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
    env: Dict[str, str] = {}       # the ONLY secret-bearing channel; the COMPLETE set for the connection
    endpoint: Optional[Endpoint] = None   # NON-secret only: base_url, api_version, region, public headers
```

`env` is the only channel that carries secret values, and it carries the **complete** secret-bearing
set the connection needs, not a single `*_API_KEY`. For the complex cloud providers (see
[harness-provider-matrix.md](harness-provider-matrix.md)):

- **Bedrock**: the `AWS_*` group (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
  (+ `AWS_SESSION_TOKEN`), or `AWS_PROFILE`, or `AWS_BEARER_TOKEN_BEDROCK`) plus the region var.
- **Vertex**: GCP ADC (`GOOGLE_APPLICATION_CREDENTIALS`) + `GOOGLE_CLOUD_PROJECT` +
  `GOOGLE_CLOUD_LOCATION`, or `GOOGLE_CLOUD_API_KEY`.
- **Azure**: `AZURE_OPENAI_API_KEY`.

The `custom_provider` secret's `key` and any secret-bearing `extras` (auth tokens, secret headers)
are projected into `env`, never into `endpoint`. `endpoint` carries only non-secret connection
config: `base_url`, `api_version`, `region`.

Because `env` is the complete set, the runner must **clear a complete known-provider-env inventory,
then apply the resolver's `env`**. The two sets are different: the resolver's `env` is the **apply**
set (what this connection needs), not the **clear** set. Clearing only what the resolver sent would
leave inherited, unrelated provider creds alive — including cloud groups (`AWS_*`, `GOOGLE_*`/ADC,
`AZURE_*`) the resolver did not mention. So the clear set is a **complete inventory** of every
provider env var (every `*_API_KEY` plus the full AWS/GCP/Azure groups), sourced from the same shared
provider-env metadata the resolver emits from (or, equivalently, the run starts from a strict
allowlisted env). The fix is not "kill the list": it **replaces the incomplete hand-maintained
`KNOWN_PROVIDER_ENV_VARS` list** in `services/agent/src/engines/sandbox_agent/daemon.ts` **with a
complete inventory derived from the shared provider-env metadata** (Security, rule 5). The harness
adapter then maps the neutral resolved connection to each harness's native shape (next section).

`SessionConfig` gains `resolved_connection`. The existing `secrets` field
(`sdks/python/agenta/sdk/agents/dtos.py:583`) stays as a compatibility alias for `env` during the
transition.

```python
class RuntimeAuthContext(BaseModel):
    project_id: UUID         # from request.state, never from the request body
```

The vault resolve takes only `project_id`. It does **not** carry the harness: the vault never
performs a harness check, so the harness does not enter the resolve contract. The harness lives in
the agent layer, which runs the capability check around the resolve (Concern 3b): a **PRE-resolve**
reject of `ModelRef.provider` and `connection.mode`, then a **POST-resolve** reject of the resolved
`deployment` (a slug-less `agenta` connection only reveals its deployment once the vault has picked
the secret). The vault resolve itself is **harness-agnostic**: it reads one secret, matches the
provider, and emits the neutral bundle, with no harness provider/mode table. Adapters:

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
2. `mode == agenta` with `slug` -> the connection whose name equals `slug` for `provider`. If none
   exists -> error ("connection `<slug>` not found"). If more than one matches
   `(project, provider, slug)` -> error (ambiguous; names must be unique to resolve).
3. `mode == agenta` with no `slug` (the project default) -> if exactly one connection exists for
   `provider`, use it. Else if exactly one connection for `provider` is named `default`, use it.
   Else -> error ("multiple connections for `<provider>`; name one in the config"). Multiple unnamed
   legacy keys for one provider are ambiguous and error the same way.
4. **Provider match.** The resolved connection's provider must equal `ModelRef.provider`. Reject a
   mismatch.

These rules never silently pick a key by iteration order, which is what the two existing readers do
differently today (agent path first-wins, `platform/secrets.py:140`; completion path last-wins,
`managers/secrets.py:219`). Uniqueness of `(project, provider, name)` is not enforced by storage in
v1; the resolver enforces it at read time and errors on a collision. (A future storage migration can
add a uniqueness constraint and an explicit default flag; out of scope here.)

### How each harness consumes the contract

The harness adapter (`adapters/harnesses.py` plus the TS engines) **maps the neutral
`ResolvedConnection` to each harness's native shape**. It never sees a vault, a connection, or a
slug. It applies whatever `env` the resolver sent (clear-then-apply), and translates the neutral
`provider`/`deployment` into the harness's own provider id and flags. The native mappings (per
[harness-provider-matrix.md](harness-provider-matrix.md)):

| Contract field | Pi | Codex | Claude Code |
| --- | --- | --- | --- |
| `provider` + `model` | `getModel(provider, id)` then `createAgentSession({ model })`; exact match | `model` + `model_provider` | `--model` / `ANTHROPIC_MODEL` by alias; provider via flags below |
| `env` (full set) | applies the whole `env`; api key via `AuthStorage.setRuntimeApiKey` or the provider's env var | `OPENAI_API_KEY` or the provider block's `env_key` | `ANTHROPIC_API_KEY`, or `ANTHROPIC_BASE_URL` for a custom gateway |
| `endpoint.base_url` | `Model.baseUrl` / `registerProvider({ baseUrl })` (**v1: NOT consumed — the runner ignores `endpoint.baseUrl`, `pi.ts:309`; staged with model-config**) | `[model_providers.<id>].base_url` | `ANTHROPIC_BASE_URL` |
| `deployment` azure/bedrock/vertex | provider `azure-openai-responses` / `amazon-bedrock` / `google-vertex` + the full `env` (**v1: NOT consumed by Pi — Pi provider + `models.json` registration stages with model-config; fail loud meanwhile**) | `model_providers` base_url + `query_params` + AWS/GCP env | `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` + AWS/GCP env (**v1: not wired, fail loud**) |
| `credential_mode = runtime_provided` | inject nothing; do not upload a fallback `auth.json`; harness uses its own login | inject nothing; uses `~/.codex/auth.json` | inject nothing; uses `.credentials.json` / inherited `CLAUDE_CODE_OAUTH_TOKEN` |
| `credential_mode = none` | inject nothing | inject nothing | inject nothing |

Claude reaches anthropic only: direct `ANTHROPIC_API_KEY`, or a custom gateway via
`ANTHROPIC_BASE_URL`. Bedrock/Vertex on Claude are declared in the capability surface but **not
wired in v1**, so a Claude run resolving to one fails loud rather than running mis-credentialed.

For Pi, the api-key `env` is applied directly. But Pi consuming a **custom endpoint or a cloud
deployment** (the `endpoint.base_url` / `models.json` / provider registration path) is **not generic
in v1**: the Agenta runner ignores `endpoint.baseUrl` and registers no Pi provider/model config
(`services/agent/src/engines/pi.ts:309`). That write into the per-run agent dir as
`auth.json`/`models.json` is the mechanism [../model-config/](../model-config/) Part 1 owns, and Pi
custom-endpoint/cloud consumption **stages with that sibling as a prerequisite** — fail-loud
meanwhile, the same posture as Claude Bedrock/Vertex. This project emits the full resolved set and
chooses which connection feeds that write; it does not claim generic Pi cloud consumption in v1.

---

## Concern 3b: the harness->providers capability lives in `/inspect`, not the API

The per-harness capability (which `providers` the harness can reach, which `deployments`
direct/azure/bedrock/vertex, and which `connection_modes`) is a **harness-layer artifact in the
SDK agent layer**, not an API/vault concern. The vault knows nothing about harnesses; only the agent
layer does.

**Where it is derived.** The capability is DERIVED from the real harness facts: Pi's env-key map and
`KnownProvider` enum, and Claude's matrix. The source data is enumerated in
[harness-provider-matrix.md](harness-provider-matrix.md): Pi's eight vault-mapped providers plus the
cloud deployments, and Claude's anthropic-only reach. The capability document is built from that, not
hand-maintained as a free-standing table.

**Where it is published.** The agent service `/inspect` response carries a `harness_capabilities`
document keyed by harness type. It is **not** a fourth schema key. The SDK inspect model
`JsonSchemas` (`sdks/python/agenta/sdk/models/workflows.py`) only allows `inputs`/`parameters`/
`outputs`, and `AGENT_SCHEMAS` (`services/oss/src/agent/schemas.py`) is exactly those three; a
`harness_capabilities` schema key cannot live there. It is exposed through the inspect response
**`meta`** (or an explicitly-extended inspect contract), separate from the three schema keys. Each
harness type maps to its `{ providers, deployments, connection_modes, model_selection }` shape (the
bottom-line block in [harness-provider-matrix.md](harness-provider-matrix.md)).

**Server-side enforcement reads the same table, not `/inspect`.** The agent service does not call its
own `/inspect` to enforce. It **imports the same SDK capability table** that `/inspect` publishes
from, and runs the fail-loud check against that in-process. `/inspect` is the frontend's read of the
table; the server-side reject reads the table directly.

**How the frontend uses it.** The frontend reads `harness_capabilities` from `/inspect` and
intersects it with `GET /vault/connections` (the project's stored secrets read as connections): for
the selected harness, it shows only the connections whose `provider`/`deployment` the harness can
reach. That is "filter which secrets to use": the frontend never offers a stored secret the selected
harness cannot use.

**Where the fail-loud check lives.** The agent service / SDK agent layer (which knows the harness)
rejects a `ModelRef` whose provider, connection mode, or resolved deployment is outside the selected
harness's capability, fail-loud, server-side, so a direct API caller is also guarded. The check is
**split around** the vault resolve:

- **PRE-resolve** (`ModelRef.provider`, `connection.mode`): rejected before the resolve, because they
  are known from the config alone.
- **POST-resolve** (`deployment`): a slug-less `agenta` connection only reveals its `deployment`
  (`direct`/`custom`/`bedrock`/...) once the vault has selected the secret, so the deployment reject
  runs after the resolve returns (e.g. Claude resolving to `bedrock` fails loud here).

Both checks read the in-process SDK capability table (the same one `/inspect` publishes), not
`/inspect` itself. The **vault resolve stays harness-agnostic**: it carries no harness provider/mode
table, takes no harness in its context, and performs no harness check — it selects deterministically
and matches the provider only. Concretely, the capability table is **removed** from
`api/oss/src/core/secrets/capabilities.py` (that file is deleted), the harness provider/mode check is
removed from the vault resolver `api/oss/src/core/secrets/connections.py`, and `harness` is dropped
from the vault resolve contract and from `RuntimeAuthContext` as the vault sees it; the equivalent
fail-loud guard now lives up in the agent layer against the imported SDK capability table.

The sibling [../harness-capabilities/](../harness-capabilities/) project owns the general
capability-table mechanism (the per-harness table and its `/inspect` exposure). This project
contributes the provider / deployment / connection_mode entries and the `/inspect` exposure shape
described above.

---

## Security non-negotiables

1. **Project from the request context, never the body.** Resolve by
   `(context.project_id, provider, slug)`.
2. **Provider match.** The resolved connection's provider must equal `ModelRef.provider`.
3. **Resolve must be genuinely internal (required v1 fix, not a note).**
   `POST /vault/connections/resolve` returns plaintext credentials in `env`. Today the equivalent
   route is mounted on the **public** secrets router (`api/oss/src/apis/fastapi/vault/router.py`,
   mounted publicly in `api/entrypoints/routers.py`), which makes it browser-reachable. "Not added to
   the Fern client" is **not** access control. v1 **must** make this endpoint genuinely
   service-internal: an internal-service auth check or a network boundary that a browser cannot
   cross, OR keep credential resolution inside server-side agent plumbing rather than exposing a
   browser-reachable route at all. This is a required v1 fix. (The existing `GET /secrets/`
   (`list_secrets`) already leaks key material in `SecretResponseDTO`; the resolve must not follow
   that pattern.)
4. **No secret values in logs, traces, errors, or the raw-JSON playground echo.** Traces carry
   provider, model, deployment, and the resolved connection slug. Never `env`.
5. **Clear a complete inventory, then apply the resolver's full env on managed runs.** The clear set
   and the apply set are different. The runner first clears a **complete known-provider-env
   inventory** — every provider `*_API_KEY` plus the full cloud groups (`AWS_*`, `GOOGLE_*`/ADC,
   `AZURE_*`) — sourced from the same shared provider-env metadata the resolver emits from, so no
   inherited cred (including cloud) leaks through. It **then** applies the complete `env` the resolver
   sent (the authoritative apply set, including the multi-variable AWS/GCP groups). The incomplete
   hand-maintained `KNOWN_PROVIDER_ENV_VARS` list in
   `services/agent/src/engines/sandbox_agent/daemon.ts` is **replaced by that complete inventory** (or
   the run starts from a strict allowlisted env), not simply deleted. Today the runner copies
   inherited provider env (`daemon.ts`) and overlays request secrets
   (`services/agent/src/engines/sandbox_agent.ts`), and in-process Pi only mutates the keys present
   in `request.secrets` (`services/agent/src/engines/pi.ts`); none of these clears the full inventory
   or applies the resolver's full set. Fix all three.
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

With `mode: agenta` and no slug, and a single OpenAI connection, the run uses it (the project
default). With two OpenAI connections and neither named `default`, `mode: agenta` with no slug errors
and asks the config to name one. With `mode: self_managed`, the resolver returns `runtime_provided`
and injects nothing.

---

## Relationship to the sibling projects

- [../model-config/](../model-config/): makes a requested model settable on each harness (the Pi
  `auth.json`/`models.json` write into the per-run agent dir, fail-loud on an unsettable model,
  model choices in the schema, the `_PROVIDER_ENV_VARS` Together fix). This project decides which
  connection's credential that write uses; model-config owns the write and the staged strict-model
  rollout (`AGENTA_AGENT_MODEL_STRICT`).
- [../harness-capabilities/](../harness-capabilities/): the capability-table mechanism and its
  `/inspect` exposure. This project contributes the `providers`, `deployments`, and
  `connection_modes` entries and their `harness_capabilities` shape on `/inspect`.
- [../capability-config/](../capability-config/): the three permission layers (harness config,
  sandbox permission, tool permission). Orthogonal to credentials.

---

## Deferred (out of scope for v1)

- A first-class `Connection` storage model with a uniqueness constraint and an explicit default
  flag, a write path, and CRUD endpoints.
- Migrating the prompt/completion path onto a shared resolution core.
- Managed OAuth (stored refresh token plus credential-helper minting).
- First-class cloud identity beyond today's custom `extras` (Bedrock/Vertex). *v1 implementation
  note:* the **resolver emitting the full cloud credential set** (the AWS/GCP groups in
  [harness-provider-matrix.md](harness-provider-matrix.md)) and the **runner clear-then-apply** of
  that set are v1. But **Pi consumption of custom-endpoint / cloud is NOT generic in v1.** The Agenta
  runner does not register Pi provider/model config and explicitly ignores `endpoint.baseUrl`
  (`services/agent/src/engines/pi.ts:309`). So Pi actually consuming a custom endpoint or a cloud
  deployment (registering the Pi provider plus `models.json`) **stages with the model-config sibling
  as a prerequisite** — the same posture as Claude's Bedrock/Vertex. **Claude's bedrock/vertex are
  declared in the capability but not wired in v1**: a Claude run resolving to one fails loud
  (`UnsupportedDeployment`, 422) rather than running mis-credentialed. Richer cloud identity (assumed
  roles, workload identity) beyond the resolved env groups is the further deferred piece.
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
- Service/API (harness-agnostic): `VaultConnectionResolver`; new `GET /vault/connections` (read list
  over existing secrets) and `POST /vault/connections/resolve` (**genuinely internal**: internal-
  service auth or a network boundary, not just "absent from the Fern client"); delete the dump in
  `resolve_provider_keys` (`sdks/python/agenta/sdk/agents/platform/secrets.py`) and its re-export
  (`services/oss/src/agent/secrets.py`); the deterministic resolution rules; emit the full
  credential set per connection (incl. the AWS/GCP groups); include `custom_provider` connections
  (`api/oss/src/apis/fastapi/vault/`, `api/oss/src/core/secrets/`). The vault resolve carries **no
  harness at all**: delete the harness capability table `api/oss/src/core/secrets/capabilities.py`
  (the file), remove its import and the harness provider/mode check from the vault resolver
  `api/oss/src/core/secrets/connections.py`, and **drop `harness` from the resolve contract and from
  `RuntimeAuthContext` as the vault sees it**. The harness travels only to the agent-layer check,
  never into the vault resolve.
- Resolution wiring: thread `ModelRef.connection` plus `RuntimeAuthContext` into the resolver call
  in `services/oss/src/agent/app.py`. The connection rides `parameters`; no new request field. The
  fail-loud harness check runs here, in the agent layer, against the imported SDK capability table,
  **split around** the resolve: provider + connection mode **before** the vault resolve; the resolved
  deployment **after** it (a slug-less `agenta` connection only reveals its deployment post-resolve).
- Harness capability on `/inspect`: carry a `harness_capabilities` document keyed by harness type in
  the inspect response **`meta`** (or an explicitly-extended inspect contract) — **not** a fourth
  `AGENT_SCHEMAS` schema key (`JsonSchemas` only allows `inputs`/`parameters`/`outputs`,
  `sdks/python/agenta/sdk/models/workflows.py`; `AGENT_SCHEMAS` in `services/oss/src/agent/schemas.py`
  is exactly those three). Derived from the Pi env-key map + `KnownProvider` and Claude's matrix (the
  [harness-provider-matrix.md](harness-provider-matrix.md) bottom-line block). The agent service
  **imports this same SDK capability table** for its server-side reject; it does not call its own
  `/inspect`. The table mechanism is the sibling
  [../harness-capabilities/](../harness-capabilities/) project's; this project supplies the
  provider/deployment/connection_mode entries and the exposure shape.
- TS engines: map `ResolvedConnection` to native shape (exact model, `runtime_provided`/`none`), and
  **clear a complete known-provider-env inventory, then apply the resolver's full `env`**. Replace
  the incomplete hand-maintained `KNOWN_PROVIDER_ENV_VARS` list in
  `services/agent/src/engines/sandbox_agent/daemon.ts` with a **complete inventory** (every provider
  `*_API_KEY` plus the full `AWS_*`/`GOOGLE_*`/ADC/`AZURE_*` groups) derived from the shared
  provider-env metadata, or start from a strict allowlisted env; the resolver's `env` is the apply
  set, not the clear set. Drop the harness-name->provider guess
  (`services/agent/src/engines/pi.ts`, `sandbox_agent.ts`). **Pi consumption of `endpoint.base_url`
  / custom-endpoint / cloud (Pi provider + `models.json` registration) is NOT in v1**: the runner
  ignores `endpoint.baseUrl` (`pi.ts:309`) and registers no Pi provider config, so this stages with
  the model-config Part 1 `auth.json`/`models.json` write as a prerequisite — fail-loud meanwhile.
- Frontend: a form on the agent config that exposes provider, model, params, connection mode
  (`agenta` / `self_managed`), and connection slug directly, plus a raw-JSON escape hatch. Reads
  `harness_capabilities` from `/inspect` and intersects with `GET /vault/connections` to show only
  the connections the selected harness can use.
