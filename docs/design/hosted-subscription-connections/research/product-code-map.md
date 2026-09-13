# Product code map

What exists today in the Agenta code, and where a hosted ChatGPT subscription connection must plug
in. Every claim below names a file. Line numbers refer to the worktree
`/home/mahmoud/code/agenta-2-worktrees/hosted-subscriptions` at branch
`spike/hosted-subscription-exploration`.

This document maps code. It does not choose an architecture. Read
[working research](../working-research.md) for the exploration direction.

## Summary of the important findings

1. A mounted subscription has **no database row**. It is three environment variables on the runner
   process that point at directories with a login file. The web UI learns about it through a status
   poll, not through a record.
2. The vault stores provider API keys. Its table already has an `organization_id` column, but every
   vault route uses `project_id` only. Project scope is what the code makes natural.
3. The harness auth home is a **runner process singleton**. Nothing in the run request can name a
   different one. This is the largest single change the feature needs.
4. Daytona plus `runtime_provided` is rejected before any sandbox starts. Subscriptions are a
   local-only capability today.
5. Nothing in the product implements an OAuth device code flow. The nearest pattern is the Composio
   connect flow, which uses a redirect and a popup, not a device code.
6. There is no status value that means "sign in again". Worse, an expired login reports `ready`,
   because the probe only checks that a file parses as JSON.

---

## 1. AI provider connections today

### 1.1 Storage

The vault is one table, `secrets`, defined in
`api/oss/src/dbs/postgres/secrets/dbes.py:8` with columns in
`api/oss/src/dbs/postgres/secrets/dbas.py:12-32`.

| Column | Line | Note |
| --- | --- | --- |
| `id` | `dbas.py:15` | uuid7 primary key |
| `slug` | `dbas.py:22` | stable identity of a connection |
| `kind` | `dbas.py:23` | `secretkind_enum` |
| `data` | `dbas.py:24` | `PGPString`, pgcrypto encrypted |
| `project_id` | `dbas.py:25` | nullable |
| `organization_id` | `dbas.py:29` | nullable |

Plus `name` and `description` from `HeaderDBA`
(`api/oss/src/dbs/postgres/shared/dbas.py:148`) and the six lifecycle columns from `LifecycleDBA`
(`shared/dbas.py:90`).

`SecretKind` has five values in `api/oss/src/core/secrets/enums.py:4-9`:
`provider_key`, `custom_provider`, `sso_provider`, `webhook_provider`, `custom_secret`.

The custom provider payload is `CustomProviderDTO` at `api/oss/src/core/secrets/dtos.py:71-79`. Its
fields are `kind`, `provider` (a `CustomProviderSettingsDTO` with `url`, `version`, `key`, `extras`
at `dtos.py:64-68`), `models`, `harnesses`, `provider_slug`, and `model_keys`. **There is no
`headers` field on a stored custom provider.** `model_keys` is computed as
`f"{provider_slug}/{data.kind.value}/{model.slug}"` at `dtos.py:374-381`, and `provider_slug`
derives from `header.name` at `dtos.py:303-313`.

### 1.2 Scope

The DAO refuses a row that names both scopes or neither. See `_validate_scope` at
`api/oss/src/dbs/postgres/secrets/dao.py:33-38`, which raises
`ValueError("Exactly one of project_id or organization_id must be provided.")`.

Only `sso_provider` secrets use organization scope. EE writes them at
`api/ee/src/core/organizations/service.py:645-648` and reads them at `:893-896`. Their non-secret
half lives in `organization_providers` (`api/ee/src/dbs/postgres/organizations/dbes.py:44`).

Every route in the vault router passes `project_id=UUID(request.state.project_id)` and never
`organization_id`. So a provider key connection is project-scoped in practice.

One gap worth knowing: the unique index is `uq_secrets_project_id_slug` on `(project_id, slug)`
(`api/oss/src/dbs/postgres/secrets/dbes.py:21-27`). There is no matching uniqueness for
`(organization_id, slug)`.

The gateway connections table, which holds Composio connections, is project-scoped only. See
`api/oss/src/dbs/postgres/gateway/connections/dbes.py:38-49`: composite primary key
`(project_id, id)`, foreign key to `projects.id` with cascade delete, and **no `user_id` column**.
A connection belongs to a project, not to a person.

### 1.3 Routes and permissions

Router class `VaultRouter` at `api/oss/src/apis/fastapi/vault/router.py:63`.

| Method | Path | operation_id | Handler | Permission |
| --- | --- | --- | --- | --- |
| POST | `/secrets/` | `create_secret` | `router.py:128` | `EDIT_SECRET` at `:132` |
| GET | `/secrets/` | `list_secrets` | `router.py:149` | `VIEW_SECRET` at `:153` |
| GET | `/secrets/{secret_id_or_slug}` | `read_secret` | `router.py:170` | `VIEW_SECRET` at `:174` |
| PUT | `/secrets/{secret_id}` | `update_secret` | `router.py:210` | `EDIT_SECRET` at `:216` |
| DELETE | `/secrets/{secret_id}` | `delete_secret` | `router.py:250` | `EDIT_SECRET` at `:254` |
| POST | `/providers/probe` | `probe_provider` | `api/oss/src/apis/fastapi/providers/router.py:146` | `EDIT_SECRET` at `:152` |

`Permission.VIEW_SECRET` and `Permission.EDIT_SECRET` are declared at
`api/oss/src/core/access/permissions/types.py:74-75`. A viewer gets view (`:182`); an editor gets
edit (`:219`). `check_action_access` is defined at
`api/oss/src/core/access/permissions/service.py:172`.

A second gate controls the value. `VaultRouter._for_caller` at `router.py:112-125` reveals a
write-only secret only when the request carries the `secret-resolve` grant, declared at
`api/oss/src/middlewares/auth.py:105`. The browser therefore never sees a stored key. It sees
`value_status.configured` and a preview.

Routes are mounted in `api/entrypoints/routers.py:1222-1245`, with a hidden deprecated alias under
`/vault/v1`.

### 1.4 The web UI

The AI providers page is a settings tab. Route file
`web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx:133-137` renders the tab whose
key is `llms`. The label is "AI providers"; the key stays `llms` so old links work
(`web/packages/agenta-settings/src/navigation.ts:162-163`).

Components:

- Shared page: `web/packages/agenta-settings-ui/src/providers/AIProvidersPage.tsx:59`. Columns at
  `:118-165`. Delete lives in the row actions at `:185-195`.
- Drawer: `web/packages/agenta-entity-ui/src/secretProvider/ProviderDrawer.tsx:48`, with three
  contexts (`settings`, `playground`, `completion`).
- Connection card: `web/packages/agenta-entity-ui/src/secretProvider/ProviderConnectionCard.tsx`.
- Subscription row card:
  `web/packages/agenta-entity-ui/src/secretProvider/SubscriptionPairCard.tsx`.

The entities module is `web/packages/agenta-entities/src/secret/`. HTTP calls go through the Fern
client in `secret/api/api.ts`:

| Function | Line | Endpoint |
| --- | --- | --- |
| `fetchVaultSecret` | `:29` | `GET /secrets/` |
| `createVaultSecret` | `:38` | `POST /secrets/` |
| `updateVaultSecret` | `:49` | `PUT /secrets/{secret_id}` |
| `deleteVaultSecret` | `:61` | `DELETE /secrets/{secret_id}` |

Mutation atoms are in `secret/state/atoms.ts`: `createVaultSecretMutationAtom` at `:192`,
`updateVaultSecretMutationAtom` at `:200`, `deleteVaultSecretMutationAtom` at `:208`,
`deleteSecretAtom` at `:328`. The single save entry point for the provider card is
`saveProviderConnectionAtom` at `secret/state/connections.ts:59-92`.

### 1.5 The provider connections plan versus the code

`docs/design/provider-connections-models/` proposes one concept called "a provider connection",
stored in two shapes, with a stable slug, server-assigned names, and subscriptions shown beside
connections without becoming vault records.

Already implemented:

- `models` and `harnesses` on both shapes (`api/oss/src/core/secrets/dtos.py:59, 61, 75`).
- Server-assigned names "OpenAI", "OpenAI 2" (`api/oss/src/core/secrets/services.py:41-60`).
- The settings table with a row-click drawer
  (`web/packages/agenta-settings-ui/src/providers/AIProvidersPage.tsx:118-224`).
- One test action returning two statuses (`POST /providers/probe`, response fields at
  `api/oss/src/apis/fastapi/providers/models.py:53-56`, enums at
  `api/oss/src/core/providers/dtos.py:8-31`).
- Connection-first model picker and the saved slug in the agent config
  (`sdks/python/agenta/sdk/agents/connections/models.py:62-65`).

Not implemented:

- The subscription model shortlist is **browser localStorage**, not a server record. See
  `web/packages/agenta-entities/src/secret/state/subscriptionModels.ts:22`, key
  `agenta:subscription-pair-models`. The plan lists this as an open decision.
- A normalized `ProviderConnection` read model in Python. It exists only in TypeScript at
  `web/packages/agenta-entities/src/secret/core/connections.ts:39-68`.
- `docs/design/provider-connections-models/status.md:15` claims "No product code changed". That
  line is stale. All four planned pull requests landed.

---

## 2. The model picker and the capability table

### 2.1 The capability table

`sdks/python/agenta/sdk/agents/capabilities.py` is the source of truth. The API serves it at
`GET /workflows/catalog/harnesses/` (`api/oss/src/resources/workflows/catalog.py:255`).

`HarnessConnectionCapabilities` is declared at `capabilities.py:333` with fields `providers`,
`deployments`, `connection_modes`, `model_selection`, `models`, `default_models`, `model_catalog`,
and `mcp`.

Three harnesses exist in `HARNESS_CONNECTION_CAPABILITIES` at `capabilities.py:381-417`:
`pi_core` at `:382`, `claude` at `:393`, `codex` at `:406`.

The two connection modes are declared once, at `capabilities.py:119`:

```python
_ALL_MODES = ["agenta", "self_managed"]
```

The literal `"openai-codex"` is a provider family for Pi subscriptions. Its models are listed at
`capabilities.py:70-86`:

```python
PI_SUBSCRIPTION_MODELS = {
    "openai-codex": ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
                     "gpt-5.5", "gpt-5.4", "gpt-5.4-mini",
                     "gpt-5.3-codex-spark"],
}
```

Codex has its own model list, `CODEX_MODELS` at `capabilities.py:109-115`.

Four functions gate a combination: `harness_allows_provider` at `:455`, `harness_allows_mode` at
`:467`, `harness_allows_deployment` at `:479`, and `harness_allows_pair` at `:505`. All fail closed
on an unknown harness. **Model ids are never gated.** Only provider, mode, and deployment are.

The gates run in `sdks/python/agenta/sdk/agents/handler.py`: `_check_harness_pre_resolve` at `:111`
and `_check_harness_post_resolve` at `:137`.

### 2.2 The connection resolver

The offline adapters live in `sdks/python/agenta/sdk/agents/connections/resolver.py`.
`EnvConnectionResolver.resolve` at `:60` and `StaticConnectionResolver.resolve` at `:137` share one
rule. A `self_managed` connection short-circuits at `:66` and `:144` and returns
`credential_mode="runtime_provided"` with `values={}`. An `agenta` connection looks up the provider
environment variable and fails closed with `MissingCredentialError` at `:97` when the key is absent.

The connected resolver is `VaultConnectionResolver` at
`sdks/python/agenta/sdk/agents/platform/connections.py:732`. Its `resolve` at `:744` short-circuits
`self_managed` at `:750-753` before any network call, so no `GET /secrets/` happens. An `agenta`
connection fetches the vault at `:761-765`, selects a candidate by slug at `:678-682`, and returns
`credential_mode="env"` at `:719`.

So the whole difference is one field. `self_managed` means "resolve to `runtime_provided` with an
empty environment". `agenta` means "select one vault secret and emit one provider environment
variable".

### 2.3 How a mounted subscription reaches the model list

This is the chain the feature must join. Four steps.

**Step 1. The runner names a provider family.** `services/runner/src/subscription-status.ts:128-138`
probes three directories:

| Harness | Environment variable | File | Provider |
| --- | --- | --- | --- |
| `codex` | `CODEX_HOME` | `auth.json` | `openai` |
| `claude` | `CLAUDE_CONFIG_DIR` | `.credentials.json` | `anthropic` |
| `pi_core` | `PI_CODING_AGENT_DIR` | `auth.json` | read from the file |

Pi maps its own ids through `PI_PROVIDER_FAMILIES` at `subscription-status.ts:89-92`, where
`"openai-codex"` becomes `"openai"`.

**Step 2. The web builds pairs.** `subscriptionPairsFrom` at
`web/packages/agenta-entities/src/secret/core/subscriptionPairs.ts:75-108`. The decisive filter is
line 86:

```ts
if (entry?.state !== "ready") continue
```

The pair key is `${provider}:${harness}` at `:99`. The plan name comes from
`PLAN_NAME_BY_PROVIDER` at `:45-48`, which maps `anthropic` to "Claude" and `openai` to "ChatGPT".

**Step 3. The web builds candidates.** `liveSubscriptionCandidates` at
`web/packages/agenta-entities/src/secret/core/agentModelCandidates.ts:199-229`. A pair is dropped
unless its harness is selectable and the harness publishes `self_managed`:

```ts
if (
    !harnessIds.includes(pair.harness) ||
    !capabilities?.[pair.harness]?.connection_modes?.includes("self_managed")
)
    continue
```

Each candidate is pushed at `:216-225` with `mode: "self_managed"`, `slug: null`,
`source: "subscription"`, and `connectionKey: "subscription:" + pair.provider`.

**Step 4. The picker renders a row.** `buildConnectionPickerRows` at
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionPicker.ts:63-73`. The row
name falls back to the plan name because no vault record exists. The group gets an olive tag
`"Subscription"` at
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/pickerSections.ts:89-102`.

**What the user sees today.** A row labelled "ChatGPT" with the tag "Subscription", holding a
section named "Codex" or "Pi", whose options come from the capability table's `default_models` for
the `openai` family.

The candidate atom is `agentModelCandidatesAtomFamily` at
`web/packages/agenta-entities/src/workflow/state/agentModelCandidates.ts:113-139`. It is called with
`showSubscriptions` hardcoded to `true` at
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx:527`.

**One live defect to know about.** Because the runner maps `openai-codex` to `openai`
(`subscription-status.ts:91`) and `subscriptionPairModels` keys on `pair.provider`
(`subscriptionPairs.ts:127`), a Pi subscription row is filled from
`capabilities["pi_core"].models["openai"]`, which is the ordinary OpenAI catalog. The seven real
codex model ids at `capabilities.py:70-86` are unreachable from the picker. The string
`openai-codex` does not appear anywhere in `web/`.

### 2.4 ProviderCredentialsSection

Container: `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSection.tsx`.
It builds a per-harness status key at `:41`, reads the status query at `:42-44`, resolves a display
at `:45-50`, and exposes a refetch as `onCheckAgain` at `:51-53`.

View: `.../ProviderCredentialsSectionView.tsx`. The mode toggle at `:377-388` offers
`{label: "API key", value: "agenta"}` and `{label: "Subscription", value: "self_managed"}`. The
self-managed card renders at `:415-482` with a status line at `:443-453` and a "Check again" button
at `:463-473`.

**This component is not mounted in the running app.** A grep for it outside its own files finds only
`web/storybook/stories/entity-ui/ProviderCredentialsSection.stories.tsx`. The live subscription
surfaces are the picker row and the provider drawer.

---

## 3. The run path

### 3.1 Hops

| From and to | Transport | Fields that matter |
| --- | --- | --- |
| Composer to chat instance | in process | `sendMessage` |
| `prepareRequest` to `buildAgentRequest` | in process | `entityId`, `messages`, `sessionId` |
| Browser to agent service | HTTP POST with SSE | `data.parameters.agent.llm`, `.harness.kind`, `.sandbox.kind` |
| Route to handler | in process | `WorkflowServiceRequest` |
| Handler to vault | HTTP `GET /secrets/` | skipped for `self_managed` |
| SDK to runner | HTTP NDJSON `POST /run` | `modelConnection.credentialMode` |
| Runner to daemon | process spawn or Daytona env | frozen environment map |

### 3.2 The web send

`buildAgentRequest` is at
`web/packages/agenta-playground/src/state/execution/agentRequest.ts:307`. The endpoint resolves to
`{origin}/services/agent/v0/invoke` through
`web/packages/agenta-entities/src/workflow/state/helpers.ts:178-189`. The body is built at
`agentRequest.ts:434-439`:

```
{ session_id, flags?, references, data: { inputs: { messages }, parameters } }
```

The model object is `parameters.agent.llm`, composed by `composeModelValue` at
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils.ts:119-148`:

```
agent.llm = { model, provider?, connection?: { mode, slug? }, extras? }
```

`connection` is omitted for the project default at `connectionUtils.ts:140-145`. **The browser never
sends a credential mode.** It sends a connection mode.

### 3.3 The agent service

`services/oss/src/agent/app.py:171-172` publishes `/invoke` and `/inspect`.
`services/oss/src/agent/app.py:177-183` adds `POST /runtime/subscription-status`.
`_agent` at `app.py:114-128` delegates everything to the SDK handler. The service parses no config
and resolves no credentials.

`services/oss/src/agent/config.py` reads five environment variables: `AGENTA_RUNNER_DIR` at `:58`,
`AGENTA_RUNNER_INTERNAL_URL` at `:64`, `AGENTA_RUNNER_TOKEN` at `:74`,
`AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` at `:81`, and `AGENTA_AGENT_TEMPLATE_DIR` at `:103`.

### 3.4 Where the credential mode is decided

It is not decided in `handler.py`. The handler only gates it. The value comes from the resolver,
driven by one input, `agent.llm.connection.mode`.

| Site | Line | Rule |
| --- | --- | --- |
| `platform/connections.py` `_resolve_from_secrets` | `:666-678` | `self_managed` gives `runtime_provided` and an empty environment |
| same function | `:715-727` | `agenta` gives `env` with the chosen vault key |
| `VaultConnectionResolver.resolve` | `:745-751` | `self_managed` skips the vault entirely |

`ResolvedConnection` validates the pairing at
`sdks/python/agenta/sdk/agents/connections/models.py:238-241`. Mode `env` needs at least one
credential; any other mode forbids credentials.

### 3.5 The runner request

Built by `request_to_wire` at `sdks/python/agenta/sdk/agents/utils/wire.py:87-187`. The schema is
`WireRunRequest` at `sdks/python/agenta/sdk/agents/wire_models.py:506-590`.

Always present (`wire.py:144-157`): `harness`, `sandbox`, `sessionId`, `agentsMd`, `model`,
`messages`, `context`, `telemetry`.

Conditionally merged (`wire.py:158-186`): `tools`, `customTools`, `toolCallback`, `permissions`,
`systemPrompt`, `appendSystemPrompt`, `gatewayGuidance`, `mcpServers`, `skills`,
`sandboxPermission`, `connection`, `modelCapabilities`, `modelConnection`, `harnessMode`,
`harnessFiles`, `gatewayPolicy`, `runContext`, `turnId`, `detached`, `projectId`,
`controlCommandId`, `effectiveParameters`.

`modelConnection` is the credential carrier. Its wire form is at
`sdks/python/agenta/sdk/agents/connections/models.py:257-274`:

```
modelConnection = {
  provider, deployment, credentialMode,
  credentials: [{binding: {kind: "environment", name}, value, usage}],
  environment?, endpoint?
}
```

The runner has **no zod schema**. Routing is manual string matching in `createRequestListener` at
`services/runner/src/server.ts:1225-1425`, and the body is an unchecked `JSON.parse` cast to
`AgentRunRequest`, whose interface is at `services/runner/src/protocol.ts:628-803`. `/run` and
`/stream` share one handler at `server.ts:1363-1414`.

### 3.6 The auth home, and why it is the hard part

`buildRunPlan` at `services/runner/src/engines/sandbox_agent/run-plan.ts:407` contains two gates
that decide a subscription run.

Daytona is rejected outright at `run-plan.ts:513-515`:

```ts
if (isDaytona && requestCredentialMode === "runtime_provided") {
  return { ok: false, error: DAYTONA_SUBSCRIPTION_UNSUPPORTED_MESSAGE };
}
```

A local run must have the harness variable set on the runner process at `run-plan.ts:521-531`:

```ts
const subscriptionEnvVar =
  acpAgent === "claude" ? "CLAUDE_CONFIG_DIR"
  : acpAgent === "codex" ? "CODEX_HOME"
  : "PI_CODING_AGENT_DIR";
if (!process.env[subscriptionEnvVar]) {
  return { ok: false, error: LOCAL_SUBSCRIPTION_MOUNT_MISSING_MESSAGE };
}
```

Where each auth home comes from:

| Harness | Auth home today | Per run? |
| --- | --- | --- |
| Claude | `CLAUDE_CONFIG_DIR` inherited verbatim at `services/runner/src/engines/sandbox_agent/daemon.ts:269-270` | No. One global value. |
| Codex | `CODEX_HOME` overridden to `<cwd>/.codex` at `codex-assets.ts:120`, but the credential source is `process.env.CODEX_HOME` read at `codex-assets.ts:101-103` | Home yes, credential mount no. |
| Pi | `PI_CODING_AGENT_DIR` set to `plan.workspace.sourcePiAgentDir` at `pi-assets.ts:821`, captured from `process.env` at `run-plan.ts:769-770` | Managed yes, subscription no. |

How the credential file reaches the harness:

- Codex subscription symlinks `<cwd>/.codex/auth.json` to `$CODEX_HOME/auth.json` at
  `codex-assets.ts:187-212`. The symlink is recreated after **every** remount at
  `services/runner/src/environment/mount-lifecycle.ts:218-224`, because geesefs degrades a symlink
  to a zero-byte file across an object store round trip (`codex-assets.ts:180-185`).
- Pi subscription uses the mounted directory in place and never copies it
  (`pi-assets.ts:796-871`). Teardown cannot delete it because `dir` stays undefined at `:865-870`.
- Claude is neither copied nor symlinked. Only the path is inherited.

Nothing in `AgentRunRequest` can name an auth home. The only credential shaped field is
`modelConnection.credentials`, which carries environment name and value pairs.

The seams a per-connection auth home must touch:

1. Wire field, in `services/runner/src/protocol.ts:589-603` and its Python mirror at
   `sdks/python/agenta/sdk/agents/connections/models.py:257-274`. Note that
   `run-plan.ts:237-243` rejects several top-level credential fields, so a new top-level field needs
   a deliberate allowance.
2. Plan capture at `run-plan.ts:769-770`. Today this is a Pi-only field with no Claude or Codex
   equivalent. A general design wants one field on `RunPlanCredentials` (`run-plan.ts:106-132`).
3. The mount presence gate at `run-plan.ts:521-531`.
4. Daemon environment inheritance at `daemon.ts:265-274`. `buildDaemonEnv` takes no plan today; the
   call site is `services/runner/src/environment/runtime-lifecycle.ts:182-189`.
5. Codex mount lookup at `codex-assets.ts:101-103`, which reads `process.env` with no parameter. Its
   caller already receives the plan, so widening `CodexHomePlan` (`codex-assets.ts:63-66`) is the
   smallest change.
6. Pi subscription branch at `pi-assets.ts:797` and `:821`.
7. **Session identity.** `services/runner/src/engines/sandbox_agent/session-identity.ts:304`
   already folds `credentialMode` into the configuration fingerprint. An auth home must join it, or a
   second connection reuses a warm daemon that holds the first connection's login.
8. **Teardown safety.** `runtime-lifecycle.ts:80-121` deletes `runAgentDir` recursively. The current
   contract is that a subscription run leaves it undefined so the real login is never deleted. Any
   change that routes a real credential store through that field destroys it.
9. **The environment is frozen.** `runtime-lifecycle.ts:11-18` builds the daemon environment once,
   before the sandbox starts. A per-request auth home must resolve inside
   `environment-setup.ts:63-461`, not after a mount lands.

---

## 4. Status and error transport

### 4.1 Subscription status

`services/runner/src/subscription-status.ts` is a local file check, stated at `:11-14`. It emits
five states, declared at `:32-42`: `ready`, `not_configured`, `login_missing`, `login_unusable`,
`unsupported`. `probeState` at `:165-196` decides them from `stat` and a JSON parse.
`hasMinimumShape` at `:145-153` only asserts that the file parses into a non-empty object.

One production caller: `services/runner/src/server.ts:1236-1240`, serving
`GET /subscription-status` behind the runner token. It runs on demand, not at startup and not
during a run.

`services/oss/src/agent/runtime_status.py` proxies it. The route is `POST
/runtime/subscription-status`, wired at `services/oss/src/agent/app.py:176-183`. It calls the runner
at `runtime_status.py:184-232` with a three second timeout. Every outcome returns HTTP 200 with a
`runner` field of `connected`, `unavailable`, or `incompatible`. The response model is at
`runtime_status.py:124-128`:

```json
{
  "runner": "connected",
  "checked_at": "2026-09-08T11:24:03Z",
  "harnesses": {
    "codex": {"state": "ready", "provider": "openai"},
    "pi_core": {"state": "ready", "providers": ["anthropic", "openai"]}
  }
}
```

The web side is `web/packages/agenta-entities/src/workflow/state/subscriptionStatus.ts`. The query
atom is at `:49-61` with `staleTime: 10_000` and `refetchInterval: 15_000`. Every whole-map consumer
shares the key `SUBSCRIPTION_STATUS_QUERY_HARNESS = "claude"` at `:41` so only one poll runs.
`resolveSubscriptionStatus` at `:113-138` maps a state to a message and a tone. The table is at
`:88-105`.

### 4.2 There is no "sign in again" state

The union is five values in the runner (`subscription-status.ts:32-42`), five in the API
(`runtime_status.py:40-48`), and five plus a fallback in the web
(`web/packages/agenta-entities/src/workflow/api/subscriptionStatus.ts:27-33`). None means expired or
revoked.

The problem is worse than a missing value. **An expired login reports `ready`**, because
`hasMinimumShape` checks only that the bytes parse. The module says so at `:11-14`. The frontend
repeats it at `state/subscriptionStatus.ts:107-112`.

The nearest neighbour is `login_unusable`, which means the bytes are bad, not that the token
expired.

Adding a state needs four coordinated edits: the runner union at `subscription-status.ts:32-42`,
`HARNESS_STATES` at `runtime_status.py:40-48`, `SUBSCRIPTION_HARNESS_STATES` at
`api/subscriptionStatus.ts:27-33`, and `HARNESS_STATE_DISPLAY` at `state/subscriptionStatus.ts:88-105`.
Until all four land, a new state degrades to "Update the runner to check subscription status" at
`:137`. That degradation is by design.

The only sign-in signal today arrives at run time, not on this endpoint:
`describeCodexSubscriptionAuthFault` at
`services/runner/src/engines/sandbox_agent/codex-assets.ts:226-239`.

### 4.3 Run errors to the chat

Correction to the brief: `api/oss/src/core/sessions/streams/` is the coordination plane only. It
manages liveness locks and mirrors them to `session_streams`, stated at
`api/oss/src/core/sessions/streams/service.py:1-13`. There is no error frame there.

The real chain:

1. The runner emits an event frame. Its shape is at `services/runner/src/protocol.ts:480-488`:
   `{type: "error", message: string, code?: string}`. `code` is optional so an older runner stays
   readable.
2. The SDK converts it to two Vercel parts in
   `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:992-1005`:
   `{"type": "data-agent-error", "data": {"code", "errorText"}}` and
   `{"type": "error", "errorText"}`. Only the first carries a code. A code that fails the pattern
   `^[a-z][a-z0-9_]{0,63}$` becomes `runner_error` (`stream.py:979-989`).
3. The web reads the code at `web/packages/agenta-chat/src/assets/trace.ts:56-65`.
4. `RunErrorBody` renders it at
   `web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx:178-253`, called at `:621-627`.

The frame carries a structured code and text. It carries **no next step and no link**. The two
action buttons the UI can show are derived entirely from the code:

- "Add your key" when the code is in `STARTER_CREDIT_CODES` (`AgentMessage.tsx:150-153`). It opens
  the provider drawer through `openProviderDrawerRequestAtom`
  (`web/packages/agenta-shared/src/state/openProviderDrawer.ts:8`).
- "Try again" when the code is in `RETRYABLE_CODES` (`AgentMessage.tsx:156-166`).

The runner error taxonomy is `RunErrorCode` at
`services/runner/src/engines/sandbox_agent/errors.ts:78-98`, with eight values: `runner_error`,
`starter_credits_exhausted`, `starter_credits_program_paused`, `starter_credits_unavailable`,
`credential_delivery_failed`, `rate_limited`, `session_turn_in_use`, `sandbox_gone`,
`execution_lost`. The auth branch at `errors.ts:466-473` appends "or log in (OAuth)" but still emits
`runner_error`, so an authentication failure has no distinct class today.

**This matters for the feature.** "Add your key" already proves the pattern a "Sign in again" button
would follow. A new code plus a new entry in one of those sets is the whole UI change.

---

## 5. Existing authorization flows to imitate

### 5.1 There is no device code flow

Nothing in `api/`, `web/`, `services/`, or `sdks/` implements RFC 8628. A repository grep for
`device_code`, `user_code`, `verification_uri`, and the device code grant URN finds no
implementation. The only description is the earlier plan at
`docs/design/hosted-subscription-connections/v0/plan.md:110-138`.

### 5.2 Composio connections, the closest pattern

Router `ToolsRouter` at `api/oss/src/apis/fastapi/tools/router.py:231`, mounted at `/tools` and
`/preview/tools` in `api/entrypoints/routers.py:1554-1565`.

| Method | Path | operation_id | Handler |
| --- | --- | --- | --- |
| POST | `/tools/connections/query` | `query_tool_connections` | `router.py:809` |
| POST | `/tools/connections/` | `create_tool_connection` | `router.py:836` |
| GET | `/tools/connections/callback` | `callback_tool_connection` | `router.py:999` |
| GET | `/tools/connections/{connection_id}` | `fetch_tool_connection` | `router.py:897` |
| DELETE | `/tools/connections/{connection_id}` | `delete_tool_connection` | `router.py:927` |
| POST | `/tools/connections/{connection_id}/refresh` | `refresh_tool_connection` | `router.py:947` |
| POST | `/tools/connections/{connection_id}/revoke` | `revoke_tool_connection` | `router.py:975` |

The callback is unauthenticated by an explicit allow list at
`api/oss/src/middlewares/auth.py:69-73`. That is the exact seam a login callback would need.

The state token is the part worth copying verbatim.
`api/oss/src/core/gateway/connections/utils.py:16` builds an HMAC signed payload with the crypt key;
`:50` validates it with `hmac.compare_digest` and a one hour lifetime at `:13`.

Pending versus connected lives in a JSONB `flags` column, `{is_active, is_valid}`, written at
`api/oss/src/core/gateway/connections/service.py:202-205` and flipped by the callback through
`api/oss/src/dbs/postgres/gateway/connections/dao.py:221-256`.

The callback returns HTML, not JSON. The card at `router.py:1838-2109` posts
`{"type": "tools:oauth:complete", "slug", "integration"}` to `window.opener` at `:2078-2080` with a
fixed target origin derived from the web URL at `:1855-1860`.

### 5.3 The web connect flow

Six implementations exist. The complete one is `useConnectFlow` at
`web/packages/agenta-entity-ui/src/clientTools/useConnectFlow.ts`.

| Concern | Line | Value |
| --- | --- | --- |
| Overall timeout | `:41`, `:374` | 180000 ms |
| Popup poll | `:43`, `:364` | 1000 ms |
| Open popup | `:322-326` | `window.open(redirectUrl, name, "width=600,height=700,popup=yes")` |
| Origin check | `:339` | must equal the API origin |
| Identity check | `:351-357` | the message slug must match |
| Settle once | `:225-228` | guarded by a ref |

Five termination conditions: the success message at `:358`, the popup closing at `:365`, the timeout
at `:374`, an explicit cancel at `:419`, and an explicit decline at `:430`.

Status chrome: `web/packages/agenta-entity-ui/src/gatewayTool/components/ConnectionStatusBadge.tsx`
renders exactly three states, "Connected", "Inactive", and "Pending".

**Important limit.** The connections list never polls. `toolConnectionsQueryAtom` at
`web/packages/agenta-entities/src/gatewayTool/hooks/useToolConnectionsQuery.ts:8` sets
`staleTime: 30_000` and no `refetchInterval`. Freshness comes from the popup handshake calling
`invalidate()`. A device code login has no popup to close, so it must add a real poll.

Also stale: three frontend call sites believe `GET /tools/connections/{id}` re-checks the provider.
It does not. The handler reads the local row at `api/oss/src/core/tools/service.py:376-386`. The
adapter's `get_connection_status` at
`api/oss/src/core/gateway/connections/providers/composio/adapter.py:316` is never called from a
route. A device code poll endpoint must actually advance the attempt, or the poll is a loop over a
stale row.

### 5.4 Google sign-in

SuperTokens, not a popup. Providers are configured at
`api/oss/src/core/auth/supertokens/config.py:78-180`. The redirect starts at
`web/oss/src/components/pages/auth/SocialAuth/index.tsx:31-37` with a full page navigation. The
callback lands on a catch-all page at `web/oss/src/pages/auth/callback/[[...callback]].tsx`, which
calls `signInAndUp()` at `:62`. No polling. Not a model for a device code.

### 5.5 The best poll to imitate

`evaluationRunQueryAtomFamily` at
`web/oss/src/components/EvalRunDetails/atoms/table/run.ts:298-330`. Three reasons:

1. It is an `atomFamily` keyed by a job id, so several concurrent attempts each get their own poll.
2. It terminates on a server reported status enum,
   `isTerminalStatus(status) ? false : 5000` at `:309-313`, not on a client signal.
3. It already disables focus and reconnect refetch at `:307-308`, which matters because the device
   code specification defines a `slow_down` response.

Pair it with the 180 second backstop from `useConnectFlow.ts:374` and the three state badge from
`ConnectionStatusBadge.tsx`.

---

## 6. Session storage and mounts

### 6.1 The mount

The tool is geesefs, pinned to `v0.43.0` in `services/runner/docker/Dockerfile.dev:38`. The argument
list is built by `geesefsArgs` at `services/runner/src/engines/sandbox_agent/mount.ts:223-243`:

```
geesefs [--endpoint <url>] --region <region> --no-detect --fsync-on-close [-f] \
        -o allow_other <bucket>:<prefix> <cwd>
```

There are **no cache flags**. The only durability lever is `--fsync-on-close` at `mount.ts:234`.

Credentials ride the child environment, never the argument list. See `credEnv` at
`mount.ts:246-253`, which sets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and
`AWS_SESSION_TOKEN`.

The bucket and prefix come from the API sign response, not from runner configuration
(`mount.ts:33-51`).

### 6.2 Environment variables

| Variable | Read at | Controls | Local dev value |
| --- | --- | --- | --- |
| `AGENTA_STORE_ENDPOINT_URL` | `api/oss/src/utils/env.py:1340` | S3 endpoint | `http://seaweedfs:8333` |
| `AGENTA_STORE_ACCESS_KEY` | `env.py:1343` | store master key, API only | `agenta-dev` |
| `AGENTA_STORE_SECRET_KEY` | `env.py:1344` | store master secret | `agenta-dev-secret` |
| `AGENTA_STORE_REGION` | `env.py:1345` | region for geesefs and signing | `us-east-1` |
| `AGENTA_STORE_BUCKET` | `env.py:1346` | bucket for every mount | `agenta-store` |
| `AGENTA_STORE_NAMESPACE` | `env.py:1347` | optional leading key segment | unset |
| `AGENTA_STORE_SIGNING_KEY` | `env.py:1357` | **the backend switch** | set in dev |
| `AGENTA_STORE_JWT_ISSUER` | `env.py:1363` | issuer of the web identity token | `http://api:8000` |
| `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS` | `env.py:1387` | credential lifetime | 43200 seconds |
| `AGENTA_MOUNTS_TUNNEL_API` | `mount.ts:553` | ngrok agent API for remote sandboxes | default `http://ngrok:4040` |
| `PI_CODING_AGENT_DIR` | `mount.ts:184` | Pi agent home and login | `/pi-agent`, bind mounted read-write |

There are no `S3_*` variables. The runner container is given **no** `AGENTA_STORE_*` variables at
all, which is deliberate (`hosting/docker-compose/oss/docker-compose.dev.yml:444-446`).

### 6.3 The API mints scoped credentials

The API does mint them. The runner holds no static store key.

| Endpoint | Handler | Permission |
| --- | --- | --- |
| `POST /sessions/mounts/sign` | `api/oss/src/apis/fastapi/sessions/router.py:1857` | `RUN_SESSIONS` and `USE_MOUNTS` at `:1873` |
| `POST /mounts/agents/sign` | `api/oss/src/apis/fastapi/mounts/router.py:357` | `USE_MOUNTS` at `:364` |

The policy is built by `ObjectStore._scope_policy` at
`api/oss/src/core/store/storage.py:145-199`. Three statements: read and write scoped to
`arn:aws:s3:::<bucket>/<prefix>/*`, unconditioned bucket metadata, and a list scoped by
`s3:prefix`. The service refuses to sign without a prefix at `storage.py:229-233`.

Two signing verbs, chosen by `is_seaweedfs` at `storage.py:106-110`, which keys purely on
`AGENTA_STORE_SIGNING_KEY`. SeaweedFS uses `AssumeRoleWithWebIdentity` at `:239`; remote S3 uses
`GetFederationToken` at `:278`.

Lifetime is 12 hours by default and geesefs does not refresh
(`api/oss/src/core/mounts/service.py:866-867`). An expired token gives ENOTCONN, and the runner
re-signs and remounts at `services/runner/src/environment/mount-lifecycle.ts:322-350`.

### 6.4 The key layout

One function builds every prefix: `MountsService._storage_key` at
`api/oss/src/core/mounts/service.py:420-433`.

```
[<namespace>/]mounts/<project_id>/<mount_id>/<path>
```

The prefix is a function of the project id and the mount row id. **Session identity and organization
identity never appear in the key.** Session identity lives in the row slug, minted by
`mint_session_slug` at `service.py:85-92`, and in the `session_id` column
(`api/oss/src/dbs/postgres/mounts/dbas.py:29-45`).

### 6.5 Is a per-connection auth home natural here?

Yes, and the layout needs no change. The precedent already exists.

The **agent mount** is the same shape as a connection mount would be. It is created by
`get_or_create_agent_mount` at `service.py:536-560`, slugged by `mint_agent_slug` at `:119-127`,
scoped by an `agent_id` column at `dbas.py:40-45`, signed by its own endpoint at
`mounts/router.py:167-175`, and it survives session teardown because `delete_session_mounts` deletes
by `session_id` (`service.py:760-781`). Its README says "Files here persist across all sessions and
runs of this agent" (`agent-mount.ts:24-29`).

A connection auth home would mirror it: a `connection_id` column, a
`mint_connection_slug`, a `get_or_create_connection_mount`, a
`POST /mounts/connections/sign`, and a runner signer copied from `signAgentMountCredentials`
(`agent-mount.ts:44-112`). Isolation comes free from the prefix scoped policy.

Four caveats, all load bearing:

1. **This reverses an explicit standing decision.** `mount.ts:145-149` excludes credentials from
   durable mounts by design, and `harnessSessionMounts` at `mount.ts:175-188` deliberately mounts
   `~/.claude/projects` rather than `~/.claude` so that `.credentials.json` is never swept in. A
   connection auth home is a deliberate exception, not a fix.
2. **geesefs degrades symlinks across remounts.** The Codex path already fights this
   (`codex-assets.ts:172-186`, issue #5692).
3. **SQLite on geesefs is unsupported.** `CODEX_SQLITE_HOME` is deliberately redirected off the
   mount at `codex-assets.ts:137-145`. A harness that keeps credentials in a SQLite keychain cannot
   use the mount.
4. **The mount layer does not answer concurrent refresh.** `--fsync-on-close` gives write-on-close
   durability, not last writer coordination.

---

## 7. Migrations and layering

### 7.1 Alembic

Four live chains and two parked ones. The rule for new work is simple: unless the change is EE only,
it goes in `api/oss/databases/postgres/migrations/core_oss/versions/`.

| Chain | Directory | Version table | Runs in |
| --- | --- | --- | --- |
| legacy core, parked | `api/oss/databases/postgres/migrations/core/` | `alembic_version` | OSS |
| shared core | `api/oss/databases/postgres/migrations/core_oss/` | `alembic_version_oss` | OSS and EE |
| EE only core | `api/ee/databases/postgres/migrations/core_ee/` | `alembic_version_ee` | EE |
| shared tracing | `api/oss/databases/postgres/migrations/tracing_oss/` | `alembic_version_oss` | OSS and EE |

Version tables are set in each chain's `env.py:23`. The design is described in
`docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md`.

Current heads: `core_oss` is `oss000000028`
(`.../core_oss/versions/oss000000028_add_session_pending_inputs.py`), `core_ee` is `ee0000000003`,
`tracing_oss` is `oss000000006`.

Revision files are named `<revid>_<snake_case_slug>.py` with a readable id, not a hash. Numbers are
hand assigned and the sequence has a hole at `oss000000025`, so check the head before choosing one.

Autogenerate is unreliable here. `env.py` uses `Base.metadata` but nothing imports every `dbes.py`,
so unimported entities are invisible and autogenerate emits spurious drops. Every recent revision is
hand written.

Migrations run through composed runners:
`python -m oss.databases.postgres.migrations.runner` for OSS and
`python -m ee.databases.postgres.migrations.runner` for EE, invoked by the `alembic` compose service
(`hosting/docker-compose/oss/docker-compose.dev.yml:341`).

### 7.2 Layering

`api/AGENTS.md` prescribes Router to Service to DAO interface to DAO implementation to database.
Core depends on interfaces. Concrete wiring happens only in `api/entrypoints/`.

Reference domain for a small project-scoped entity: **`folders`**, 1443 lines total.
`api/oss/src/dbs/postgres/folders/dbes.py:26` is the canonical project-scoped entity shape. A larger
but more complete example is `mounts`, which has every file the specification names.

The vault itself is already in the new layering. There is no legacy vault router and no legacy
secrets service. Only the URL prefix `/vault/v1` is legacy, mounted hidden at
`api/entrypoints/routers.py:1242`.

**Name collision warning.** `connections` is taken. `api/oss/src/core/gateway/connections/` and
`api/oss/src/dbs/postgres/gateway/connections/` own the `gateway_connections` table, and the class
names `ConnectionDBE`, `ConnectionsDAO`, and `ConnectionsService` are imported by name in
`api/entrypoints/routers.py:151-156`.

### 7.3 The template to copy

**Primary: pull request #6555**, merge commit `ffa7765e36`. The commit to copy is `892e2ba988`,
"feat(api): persist queued session input", dated 2026-09-04. It is 18 files and a complete vertical
slice:

```
api/oss/databases/postgres/migrations/core_oss/versions/oss000000028_add_session_pending_inputs.py
api/oss/src/core/sessions/inputs/{types,dtos,interfaces,service}.py
api/oss/src/dbs/postgres/sessions/inputs/{dbes,mappings,dao}.py
api/oss/src/apis/fastapi/sessions/{models,router}.py
api/entrypoints/routers.py
api/oss/tests/pytest/unit/sessions/test_pending_inputs_service.py
web/packages/agenta-entities/src/session/{api/api.ts,core/schema.ts,state/pendingInputs.ts}
web/packages/agenta-api-client/src/generated/**   (Fern regeneration)
```

**Backup: commit `4bdcad8324`, pull request #6503**, "feat(api): record a session command". 14 files,
one new table, every layer, no frontend. It is the tightest example in the repository.

Note on discovery: feature commits carry no pull request number. The number lives on the merge
commit. Recover it with `git log --merges --ancestry-path <sha>..HEAD | tail -1`.

---

## Smallest integration proposal

This lists what the code needs. It does not design a framework.

### Scope: project

Choose **project scope**. Reasons, all from the code:

- Every vault route already passes `project_id` and never `organization_id`
  (`api/oss/src/apis/fastapi/vault/router.py:129-255`). Organization scope on `secrets` exists only
  for single sign-on providers, written from EE at
  `api/ee/src/core/organizations/service.py:645-648`.
- The permission check is project-scoped. `check_action_access` takes `project_id`
  (`api/oss/src/core/access/permissions/service.py:172`), and `EDIT_SECRET` is granted to editors
  (`api/oss/src/core/access/permissions/types.py:219`).
- Gateway connections, the closest analogue, are project-scoped with a composite primary key
  `(project_id, id)` (`api/oss/src/dbs/postgres/gateway/connections/dbes.py:41`).
- The object store key layout is `mounts/<project_id>/<mount_id>` and has no organization segment
  (`api/oss/src/core/mounts/service.py:420-433`). The minted credential policy scopes on that
  prefix (`api/oss/src/core/store/storage.py:169-179`).

Organization scope would need a new uniqueness constraint, a new permission path, and a new key
segment. Project scope needs none of those.

### (a) Store a ChatGPT connection per project

Add a new secret kind rather than a new table. A subscription connection is a project-scoped,
encrypted, slugged record, which is exactly what `secrets` already is.

| File | Change |
| --- | --- |
| `api/oss/src/core/secrets/enums.py:4-9` | add `subscription_provider` to `SecretKind` |
| `api/oss/src/core/secrets/dtos.py:112-118` | add a `SubscriptionProviderDTO` to the `SecretDataDTO` union |
| `api/oss/src/core/secrets/dtos.py:121-250` | extend `_validate_secret_data_based_on_kind` |
| `api/oss/src/core/secrets/redaction.py:31-37` | add the new kind to `PRIMARY_CREDENTIAL_FIELDS` |
| `api/oss/databases/postgres/migrations/core_oss/versions/oss000000029_*.py` | `ALTER TYPE secretkind_enum ADD VALUE`, style copied from `api/ee/databases/postgres/migrations/core_ee/versions/ee0000000003_add_records_ingested_meter.py` |

The record holds the connection identity and the login state. It does not need to hold the tokens if
the tokens live in the auth home mount, which is the point of (d).

If the connection also needs a durable auth home, add the mount alongside it, mirroring the agent
mount: a `connection_id` column on `mounts` (`api/oss/src/dbs/postgres/mounts/dbas.py:40-45`), a
`mint_connection_slug` beside `mint_agent_slug` (`api/oss/src/core/mounts/service.py:119-127`), and
`POST /mounts/connections/sign` beside the agent route
(`api/oss/src/apis/fastapi/mounts/router.py:167-175`).

### (b) Start and poll a device login

New routes on the vault router, or a small sibling router. Three endpoints:

```
POST /secrets/{secret_id}/login-attempts       -> {attempt_id, verification_uri, user_code, expires_at, poll_after_ms}
GET  /secrets/{secret_id}/login-attempts/{id}  -> {state}
POST /secrets/{secret_id}/login-attempts/{id}/cancel
```

Files:

| File | Change |
| --- | --- |
| `api/oss/src/apis/fastapi/vault/router.py:72-110` | register three routes with explicit operation ids |
| `api/oss/src/core/secrets/services.py` | start, poll, and cancel an attempt |
| `api/oss/src/core/secrets/types.py` (new) | typed domain exceptions, per `api/AGENTS.md` |

Copy the signed state token from `api/oss/src/core/gateway/connections/utils.py:16-60` if the flow
needs a callback. A pure device code flow does not.

The poll endpoint **must advance the attempt server-side**. Do not repeat the mistake at
`api/oss/src/core/tools/service.py:376-386`, where a fetch reads only the local row while three
frontend call sites believe it re-checks the provider.

Web side, three files:

| File | Change |
| --- | --- |
| `web/packages/agenta-entities/src/secret/api/api.ts` | three Fern calls beside the existing four |
| `web/packages/agenta-entities/src/secret/state/` new file | an `atomFamily` keyed by attempt id, copying `web/oss/src/components/EvalRunDetails/atoms/table/run.ts:298-330`, terminating on the state enum, with the 180 second backstop from `web/packages/agenta-entity-ui/src/clientTools/useConnectFlow.ts:374` |
| `web/packages/agenta-entity-ui/src/secretProvider/` new card | show the user code and the verification link, with the three states from `web/packages/agenta-entity-ui/src/gatewayTool/components/ConnectionStatusBadge.tsx` |

### (c) Show it in the model list

Two options. Prefer the second.

**Option 1, reuse the subscription path.** Make the runner report the hosted connection through
`GET /subscription-status`. This needs no web change but forces a per-connection query onto an
endpoint that takes no arguments today (`services/runner/src/subscription-status.ts:232-243`,
`services/oss/src/agent/runtime_status.py:110-121` forbids a request body).

**Option 2, treat it as a connection.** The picker already handles vault-backed connections through
`connectionCandidates` at
`web/packages/agenta-entities/src/secret/core/agentModelCandidates.ts:142-197`. A stored
subscription row would flow through it with two changes:

| File | Change |
| --- | --- |
| `web/packages/agenta-entities/src/secret/core/connections.ts:83-118` | map the new kind in `toProviderConnections` |
| `web/packages/agenta-entities/src/secret/core/agentModelCandidates.ts:142-197` | emit `mode: "self_managed"` with a real `slug` for the new kind |

This blocker is now fixed. `Connection._reject_slug_for_self_managed` in
`sdks/python/agenta/sdk/agents/connections/models.py` **rejected a self-managed connection that
carried a slug**, and a hosted connection needs both. The validator was removed on 2026-09-08, so a
`self_managed` connection may now name a slug.

Also worth fixing while here: the `openai-codex` family never reaches the picker because the runner
flattens it to `openai` at `services/runner/src/subscription-status.ts:91`, so the seven real codex
model ids at `sdks/python/agenta/sdk/agents/capabilities.py:70-86` are unreachable.

### (d) Route a run to that connection's auth home

This is the largest change. Seven files, in dependency order:

| Order | File | Change |
| --- | --- | --- |
| 1 | `sdks/python/agenta/sdk/agents/connections/models.py:257-274` | emit an auth home reference inside `modelConnection` |
| 2 | `sdks/python/agenta/sdk/agents/wire_models.py:589` | mirror it on `WireRunRequest` |
| 3 | `services/runner/src/protocol.ts:589-603` | mirror it on `ModelConnection` |
| 4 | `services/runner/src/engines/sandbox_agent/run-plan.ts:769-770` | replace the `process.env` capture with the request value, and generalize the Pi-only field into one field on `RunPlanCredentials` at `:106-132` |
| 5 | `services/runner/src/engines/sandbox_agent/run-plan.ts:521-531` | change the gate from "is the global variable set" to "does this connection's home exist" |
| 6 | `services/runner/src/engines/sandbox_agent/daemon.ts:265-274` | take the resolved home from the plan instead of `process.env`; the call site is `services/runner/src/environment/runtime-lifecycle.ts:182-189` |
| 7 | `services/runner/src/engines/sandbox_agent/codex-assets.ts:101-103` | take the mount directory from the plan; widen `CodexHomePlan` at `:63-66` |

Two non-negotiable follow-ons in the same change:

- **Fingerprint.** Add the auth home to the configuration fingerprint at
  `services/runner/src/engines/sandbox_agent/session-identity.ts:304`. Without it a second
  connection reuses a warm daemon holding the first connection's login.
- **Teardown.** Keep the auth home out of `runAgentDir`. `services/runner/src/environment/runtime-lifecycle.ts:80-121`
  deletes that path recursively.

**Scope decision the user must make.** Daytona plus `runtime_provided` is rejected at
`services/runner/src/engines/sandbox_agent/run-plan.ts:513-515`. Hosted subscriptions in the cloud
need that restriction lifted, which means shipping a login into a third-party sandbox. That is a
separate security decision, not part of this integration. A first release that runs local only needs
no change there.

### (e) Surface "sign in again"

Two paths, both small. Ship both.

**At run time**, which is where the truth is. Add one code to the taxonomy and one entry to the
retry set:

| File | Change |
| --- | --- |
| `services/runner/src/engines/sandbox_agent/errors.ts:78-98` | add `subscription_login_required` to `RunErrorCode` |
| `services/runner/src/engines/sandbox_agent/errors.ts:466-473` | emit it from the auth branch instead of `runner_error` |
| `web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx:150-166` | add it to a set so a button appears |

The button pattern already exists. "Add your key" at `AgentMessage.tsx:235-244` opens the provider
drawer through `openProviderDrawerRequestAtom`
(`web/packages/agenta-shared/src/state/openProviderDrawer.ts:8`). A "Sign in again" button opens the
same drawer at the connection.

**On the status poll**, four coordinated edits, or the new state silently degrades to "Update the
runner":

| File | Line | Change |
| --- | --- | --- |
| `services/runner/src/subscription-status.ts` | `:32-42` | add `login_expired` to the union |
| `services/oss/src/agent/runtime_status.py` | `:40-48` | add it to `HARNESS_STATES` |
| `web/packages/agenta-entities/src/workflow/api/subscriptionStatus.ts` | `:27-33` | add it to `SUBSCRIPTION_HARNESS_STATES` |
| `web/packages/agenta-entities/src/workflow/state/subscriptionStatus.ts` | `:88-105` | add it to `HARNESS_STATE_DISPLAY` |

Be careful with the probe. `hasMinimumShape` at `subscription-status.ts:145-153` deliberately avoids
reading harness credential formats. Detecting expiry means reading an `expires_at` field, which
couples the runner to a private format. The run-time path has no such problem, which is why it
should ship first.
