# Plan

A stacked PR plan for v1. Each PR is reviewable on its own, lands green, and does not regress
current behavior until the slice that intentionally replaces it. Names follow [design.md](design.md):
`ModelRef` (with `connection`), `Connection`, `ResolvedConnection`, `ConnectionResolver`.

> **Status (2026-06-24 replan):** PR **#4815** is open and must be reworked away from the new
> `/vault/connections` API surface. Keep the useful internal concepts (`ModelRef`, `Connection`,
> `ResolvedConnection`, clear-then-apply env, and harness checks), but resolve from the existing
> `GET /secrets/` response inside the service/SDK agent path. The agent layer builds an in-memory
> catalog from existing `provider_key` and `custom_provider` vault records, selects one connection,
> and maps that selected secret through the chosen harness. Do **not** add new vault routes or a new
> storage model. The shared wire/DTO hunks still ride in sibling PR #4814; #4815 should continue to
> use GitButler lanes and keep shared-file changes coordinated there.

## Scope guardrails

- No new credential storage model, write path, or CRUD. Connections are a read view over the
  existing `secrets` table; writes stay on the existing `/secrets` UI/API.
- No storage migration, no change to the vault encryption column or the `/secrets` API.
- No prompt/completion-path migration, no managed OAuth, no first-class cloud identity beyond
  today's custom `extras`.
- No new capability-table mechanism; the sibling [../harness-capabilities/](../harness-capabilities/)
  project owns the table and its `/inspect` exposure. v1 contributes the provider / deployment /
  connection_mode entries and the `harness_capabilities` shape published on `/inspect`. **The vault
  resolve stays harness-agnostic**: no harness provider/mode table lives in the API.

## Coordination with sibling projects

- [../model-config/](../model-config/) owns the Pi `auth.json`/`models.json` write into the per-run
  agent dir, the `_PROVIDER_ENV_VARS` Together fix, and the staged `AGENTA_AGENT_MODEL_STRICT`
  rollout. PR 4 here consumes that write (choosing which connection feeds it) and follows the staged
  strict rollout rather than flipping strict immediately.
- [../harness-capabilities/](../harness-capabilities/) owns the static table, `/inspect`, and FE
  gating. PR 2 adds the `providers`/`deployments`/`connection_modes` entries to the
  `harness_capabilities` document carried in the `/inspect` response **`meta`** (not a fourth
  `AGENT_SCHEMAS` schema key — `JsonSchemas` allows only `inputs`/`parameters`/`outputs`) and the
  split agent-layer reject (the agent service imports the same SDK table rather than calling its own
  `/inspect`); PR 5 consumes them in the form.

## PR 1: Neutral types and the resolver port (no behavior change)

> **Basing:** the shared wire/DTO files (`sdks/python/agenta/sdk/agents/dtos.py`,
> `sdks/python/agenta/sdk/agents/utils/wire.py`, `services/agent/src/protocol.ts`) are carried by
> sibling **PR #4814**. PR 1 **bases on #4814** and does **not** claim those shared files as its own
> payload — it adds only the non-shared, pure files of this project. The shared `ModelRef`/`Connection`
> field additions and the `/run` wire fields are #4814's hunks; PR 1 consumes them.

- **(via #4814, consumed here)** `ModelRef` (with `connection`, `"provider/model"` and bare-string
  coercion) wired into `AgentConfig.model` and `HarnessAgentConfig.model`, and the non-secret `/run`
  contract fields (`provider`, `connection`, `deployment`, `endpoint`, `credential_mode`) on both
  sides (`dtos.py`, `utils/wire.py`, `services/agent/src/protocol.ts`) with golden-test updates, land
  in the shared sibling PR #4814. PR 1 builds on those, it does not re-author them.
- **(changed)** `Connection` has **two modes**: `mode: Literal["agenta", "self_managed"]` (default
  `"agenta"`) and `slug: Optional[str]` (meaningful only for `agenta`: omitted = the project default,
  set = that named connection). There is no standalone `default` mode. Bare-string and
  `"provider/model"` coercion default to `{ mode: agenta }`. (This is part of the shared `Connection`
  type in #4814; called out here because it is load-bearing for this project's resolution rules.)

  *Implementation notes (two-mode purge — verify no `default` branch survives):*
  - Change `Connection.mode` from `Literal["default", "self_managed", "agenta"]` to
    `Literal["agenta", "self_managed"]` in
    `sdks/python/agenta/sdk/agents/connections/models.py`.
  - Remove every "default mode" branch/discussion in `services/oss/src/agent/app.py`; "the project
    default" is just `agenta` with no slug, handled by the resolution rules.
  - **Reject `slug` when `mode == self_managed`** (model validation): a self-managed connection has
    nothing for a slug to resolve against, so a slug-bearing `self_managed` is invalid.
- **(changed)** Add the **non-shared, pure** files this PR owns: `Endpoint`, `ResolvedConnection`,
  `RuntimeAuthContext` (project_id only — **no `harness`**), the `ConnectionResolver` Protocol,
  `EnvConnectionResolver`, and `StaticConnectionResolver` in a new
  `sdks/python/agenta/sdk/agents/connections/` module (reuse the sdk-local-tools `SecretResolver`
  pattern). Put `resolved_connection` on `SessionConfig`, keeping `secrets` as a compatibility alias
  for its `env`. `ResolvedConnection.env` carries the **complete** secret set for the connection (for
  the cloud providers, the multi-variable AWS/GCP groups in
  [harness-provider-matrix.md](harness-provider-matrix.md)), not a single key.
- The service still produces today's env map, now through the resolver shape. No new endpoint.

**Acceptance:** existing agent and wire golden tests pass unchanged in meaning (the wire hunks are in
#4814; PR 1 is green on top of it); `ModelRef` round-trips `"openai/gpt-5.5"`, `"gpt-5.5"`, and a full
object with a connection; bare-string and `"provider/model"` default to `{ mode: agenta }`; there is
no `default` mode; a `self_managed` connection carrying a `slug` is rejected; a standalone run with
`OPENAI_API_KEY` in env resolves a plan carrying just that var via `EnvConnectionResolver`.

## PR 2: Secret catalog resolver + capability on `/inspect`

- Remove the PR #4815 `GET /vault/connections` and `POST /vault/connections/resolve` additions.
  They duplicate data already available through `/secrets/` and introduce a new secret-bearing API
  boundary. The reworked slice should not add any vault routes.
- Add a service/SDK-side `SecretConnectionCatalog` (name flexible) that projects the existing
  `/secrets/` response into connection candidates:
  - `provider_key`: slug from `header.name`, provider from `data.kind`, key from
    `data.provider.key`, deployment `direct`.
  - `custom_provider`: slug from `header.name` / `data.provider_slug`, deployment from `data.kind`
    (`custom`, `bedrock`, `vertex_ai`, `azure`, ...), endpoint from `data.provider.url/version`, auth
    from `data.provider.key` and `data.provider.extras`, model choices from `data.models[]` and
    computed `data.model_keys`.
- Normalize the **existing** custom-provider extras shape before producing harness env. The current
  UI writes snake-case keys such as `api_key`, `aws_region_name`, `aws_access_key_id`,
  `aws_secret_access_key`, `aws_session_token`, `vertex_ai_project`, `vertex_ai_location`, and
  `vertex_ai_credentials`. Do not require uppercase env-var names in the stored vault JSON.
- Implement the **two-mode** deterministic selection rules from [design.md](design.md):
  `self_managed`; `agenta`+slug (missing -> error, ambiguous duplicate -> error); `agenta` with no
  slug = project default (exactly-one, or uniquely-named `default`, else error); provider/model
  match where known. Never pick by iteration order.
- Emit a `ResolvedConnection`-shaped plan from the selected secret only. `env` is the apply set for
  that one connection; endpoint/deployment/model are non-secret context for the harness mapper.
- Carry the per-harness `{ providers, deployments, connection_modes, model_selection }` document in
  the `/inspect` response **`meta`** (or an explicitly-extended inspect contract), not a fourth
  `AGENT_SCHEMAS` key. The agent service imports the same SDK capability table for its server-side
  reject.
- Replace `VaultConnectionResolver`'s route call with a resolver that uses the existing `/secrets/`
  list and the catalog above. The old `resolve_provider_keys` whole-vault env dump stays deprecated
  or is deleted only after all agent call sites use the selected-connection resolver.

**Acceptance:** two OpenAI connections coexist and resolve by slug; a run injects exactly one key;
a `custom_provider` connection resolves from the existing vault shape, including snake-case extras;
`/inspect` `meta` publishes `harness_capabilities` (no new `AGENT_SCHEMAS` schema key); there are no
new `/vault/connections` routes; an absent slug, an ambiguous slug, a provider mismatch, and a
provider/deployment/mode the selected harness cannot reach each return a clear error; `mode: agenta`
with no slug and two unnamed connections errors.

## PR 3: Honor the config-stored connection

- **(changed)** Make resolution honor the **two-mode** `ModelRef.connection`: `agenta` with no slug
  (project default), `agenta`+`slug` (named), and `self_managed`, per the rules, fail-loud as
  specified.
- Thread `ModelRef.connection` and a populated `RuntimeAuthContext` (**project from request context
  only — no `harness` in the vault contract**) into the resolver call in
  `services/oss/src/agent/app.py`. The connection arrives inside `parameters` (the config the handler
  already receives); no new request field.
- **(changed)** The agent-layer harness reject runs **here**, against the imported SDK capability
  table, **split around** the resolve: reject `ModelRef.provider` + `connection.mode` **before** the
  vault resolve; reject the resolved `deployment` **after** it returns (a slug-less `agenta`
  connection only reveals its deployment once the secret is selected — e.g. Claude resolving to
  `bedrock` fails loud at this post-resolve step).
- Remove the whole-vault env dump call site and swap the running path onto the selected-connection
  catalog resolver. The agent path may still call `GET /secrets/`; the important change is that it
  selects one connection from that payload and passes only that connection's env to the harness.
- Reject any attempt to pass a project id through the body; resolve from request context only.

**Acceptance:** a committed revision carries a portable `connection` and resolves per project; a test
invoke that sends the config inline with a different connection uses exactly that; reusing a revision
in a project missing the slug fails loud; `self_managed` injects nothing; a provider/mode the harness
cannot reach is rejected pre-resolve and a deployment it cannot reach (Claude+bedrock) post-resolve;
only the selected connection's env reaches the harness.

## PR 4: Harness and runner consume ResolvedConnection

- `adapters/harnesses.py` (+ the TS engines): map the neutral `ResolvedConnection` to each harness's
  native shape (Pi: the api-key `env` directly; Claude: direct/custom gateway env, Bedrock/Vertex flags and credential env when selected).
- **(changed)** TS engines: apply `provider`+`model` exactly, honor `runtime_provided`/`none` (inject
  nothing), and **clear a complete known-provider-env inventory, then apply the resolver's full
  `env`**. The clear set and the apply set are **different**: the resolver's `env` is the apply set,
  not the clear set, so clearing only what it sent would leave inherited unrelated creds (incl. cloud)
  alive. **Replace the incomplete hand-maintained `KNOWN_PROVIDER_ENV_VARS` list** in
  `services/agent/src/engines/sandbox_agent/daemon.ts` **with a complete inventory** — every provider
  `*_API_KEY` plus the full `AWS_*`/`GOOGLE_*`/ADC/`AZURE_*` groups, sourced from the shared
  provider-env metadata — or start from a strict allowlisted env. Also fix the request-secrets overlay
  in `sandbox_agent.ts` and the present-keys-only mutation in `pi.ts` to clear the inventory and apply
  the full resolved set. Drop the `acpAgent === "claude" ? ... : ...` provider guess.
- Gate Pi's OAuth `auth.json` upload behind `runtime_provided`, not the old `hasApiKey` guess.
- **(changed)** Custom endpoint / cloud delivery: Claude Code should pass selected custom model ids
  through to the configured backend instead of requiring Agenta to classify them as Sonnet/Opus/Haiku.
  For Bedrock set `CLAUDE_CODE_USE_BEDROCK=1`, normalized AWS env/region, and the selected model id
  via `ANTHROPIC_MODEL` or `ANTHROPIC_CUSTOM_MODEL_OPTION`. For Vertex set `CLAUDE_CODE_USE_VERTEX=1`,
  normalized GCP/Vertex env, and the selected model id similarly. If the backend rejects an arbitrary
  id such as `gpt-5.5`, fail loud for the explicit selected model. Do not add model-family metadata
  to `custom_provider.data.models[].extras` in this PR; that can come later for UX/prevalidation.
  Pi custom-endpoint/cloud consumption still stages with model-config's provider/model registration.
- Model strictness: follow model-config's staged `AGENTA_AGENT_MODEL_STRICT` rollout. Do not flip
  strict-fail on by default in this PR (the playground sends a default model on every run); ship the
  exact-resolution path and the clearer error behind the flag, default off, per model-config.

**Acceptance:** an api-key provider runs on Pi with exactly the resolved key; `runtime_provided` runs
with no injected key and uses the harness login; the resolved `env` is the only provider env present
on a managed run (no inherited key leaks through — incl. cloud groups — and the clear inventory is
complete, not the old `KNOWN_PROVIDER_ENV_VARS` list); a Claude run that resolves to Bedrock/Vertex
fails loud; a Pi run that resolves to a custom endpoint or a cloud deployment fails loud in v1
(consumption staged with model-config).

## PR 5: Minimal frontend (form-like)

- **(changed)** A form on the agent config that exposes the variables directly: a provider selector,
  a model field, the `params` map, a **two-mode** connection control (Use an Agenta connection /
  Self-managed; the Agenta connection picker offers the project default or a named connection), and a
  connection-slug/model picker derived from existing `/secrets/`. Plus a raw-JSON escape hatch for the exact
  `ModelRef`.
- **(changed)** Read `harness_capabilities` from the `/inspect` response `meta` for the selected
  harness and **intersect it with the existing `/secrets/` projection**: show only the stored connections whose
  provider/deployment the harness can reach, and only the connection-mode options it supports. This is
  "filter which secrets to use."
- No redesign of the rest of the playground. Adding a connection stays on the existing secrets UI.

**Acceptance:** a user picks a provider, model, and connection, or toggles self-managed, or pastes
JSON, and the run uses exactly that; the form shows only the connections the selected harness can
use (the intersection of `/inspect` capability and `GET /vault/connections`).

## Cross-cutting: trace which connection ran

Record the resolved connection slug and credential mode on the workflow span (never the key), so a
run is reproducible and an operator can see which connection paid. Land with PR 2.

## Test strategy

- SDK unit: `ModelRef`/`Connection` coercion and the two-mode union (`agenta`/`self_managed`, no
  `default`), a slug-bearing `self_managed` rejected, `ResolvedConnection`/`Endpoint` shape (full-env
  for a cloud provider), `EnvConnectionResolver`, `StaticConnectionResolver`.
- Wire golden: the new non-secret fields on both Python and TS sides — these live in sibling PR
  **#4814** (the shared wire/DTO files), which #4815 bases on.
- API unit: unchanged `/secrets/` list behavior; no new connection routes.
- Service/SDK unit: catalog projection from `provider_key` and `custom_provider`; lowercase/snake-case
  custom extras normalization; direct, custom, cloud, and self-managed selection; the two-mode
  deterministic rules (absent slug, ambiguous slug, no-slug default exactly-one vs named vs error,
  provider mismatch); least-privilege (only the selected connection's vars reach the plan, including a
  complete cloud group).
- Engine (vitest): contract application for Pi and Claude, including `runtime_provided`/`none`, the
  **complete clear inventory then apply** of the resolver's full `env` (the resolved env is the only
  provider env left, no inherited key — incl. cloud — leaks; the old incomplete
  `KNOWN_PROVIDER_ENV_VARS` list is gone), exact model pass-through, Claude Bedrock/Vertex env generation with arbitrary custom model ids
  passed through, and a Pi custom-endpoint / cloud resolve failing loud in v1 where consumption remains
  staged with model-config.
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
