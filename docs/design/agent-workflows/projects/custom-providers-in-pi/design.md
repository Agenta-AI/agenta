# Design: the contracts, classified by role

This project touches five contracts. Each one below is run through the `design-interfaces` pass:
what the field is, who owns it, when it changes, and which semantic role it plays (data, config,
policy, credentials, routing, or metadata). The point is to fix the shape while it is on paper.

The one rule: classify a field by the role it plays, not the feature it touches.

## 1. The `deployment` field on `ResolvedConnection`

### What it is today

`deployment: str = "direct"` on `ResolvedConnection` (`connections.py`, emitted at `:431-438`).
Values in play: `direct`, `azure`, `bedrock`, `vertex`/`vertex_ai`, `custom`, and, by the bug,
any raw vault kind such as `openrouter`. It is read by `harness_allows_deployment`
(`capabilities.py:225-236`) to gate a run against the harness's advertised `deployments`.

### The role it should play

`deployment` is a **routing/config** field. It answers "which access surface and auth mechanism
does the harness use to reach this model." It is service-derived (the resolver sets it after
selecting the secret) and it changes per connection, never per call. A direct API-key provider,
an Azure OpenAI deployment, Bedrock, and Vertex are genuinely different surfaces: different auth
shapes, different endpoint mechanics, different harness flags. That is a real routing distinction
and the field earns its place.

### The defect: it conflates two different questions

Today `deployment` answers a second, unrelated question: "is this vault record a `custom_provider`
or a `provider_key`." A custom OpenRouter connection is a single bearer key sent to an
OpenAI-completions endpoint at a base URL. In every routing sense it is `direct`. Its only "custom"
property is the base URL override, and that already lives in a separate field (`endpoint.base_url`).
So echoing the record kind into `deployment` (`connections.py:281`) leaks an implementation detail
(the vault storage kind) into a routing field. That is the `design-interfaces` rule 6 violation
(do not expose an implementation detail as interface structure) and rule 10 (separate intent from
mechanism).

### The fix, by role

Normalize `deployment` to the closed set of real access surfaces, and let `endpoint` carry the
"customness":

- A `custom_provider` whose kind is in `_PROVIDER_ENV_VARS` (a known single-key direct provider:
  OpenAI, OpenRouter, Anthropic, Gemini, Mistral, Groq, Minimax, Together) resolves as
  `deployment="direct"`. Its base URL and version ride `endpoint`; its key rides `env`.
- A `custom_provider` whose kind is `azure` / `bedrock` / `vertex` keeps its cloud-surface
  `deployment`. Those stay fail-loud on Pi in v1 (non-goal).
- `deployment` becomes a closed enum of access surfaces (`direct`, `azure`, `bedrock`, `vertex`),
  not an open echo of the vault kind. The free `"custom"` value goes away: a custom endpoint is
  `direct` plus an `endpoint`.

This is the smallest correct change and it needs nothing new on the wire. After it, a custom
OpenRouter connection passes Pi's `["direct"]` gate, and `resolved_env` already emits
`OPENROUTER_API_KEY`, so a built-in OpenRouter id is settable through Pi's env-var channel.

Rejected alternative: add each known-direct kind (`openrouter`, `openai`, ...) to Pi's
`deployments` list. That is a category error. Those are providers, not deployment surfaces, and it
would make the capability table advertise "openrouter" as a deployment. Keep `deployment` a
surface and `provider` a provider.

## 2. The Pi `models.json` shape (Slice 2, the runner write)

The runner writes this file into `PI_CODING_AGENT_DIR`. It is Pi's own config format
(`docs/models.md`), so the outer shape is fixed by Pi. The `design-interfaces` work is on how each
value is sourced and, above all, that the credential is a reference, not a secret.

```json
{
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "api": "openai-completions",
      "apiKey": "$OPENROUTER_API_KEY",
      "models": [{ "id": "anthropic/claude-3.5-sonnet" }]
    }
  }
}
```

| Field | Role | Owner / lifecycle | Source in our contract |
| --- | --- | --- | --- |
| `providers` | config, extensible map (plural, correct) | service, per run | keyed by `resolved_connection.provider` |
| `providers.<p>.baseUrl` | routing (the endpoint being contacted, nested under the provider) | service, per run | `resolved_connection.endpoint.baseUrl` |
| `providers.<p>.api` | config (the wire dialect) | service, per run | derived from provider (default `openai-completions`; Anthropic to `anthropic-messages`) |
| `providers.<p>.apiKey` | credentials, expressed as an env **reference** | service, per run | `"$" + env_var(provider)`, never the raw key |
| `providers.<p>.models[].id` | config/data (the registered model catalog) | service, per run | `resolved_connection.model` (the selected exact id) |

The load-bearing rule is `design-interfaces` rule 8: prefer a reference over a raw secret. `apiKey`
is written as `"$OPENROUTER_API_KEY"`, an env interpolation Pi resolves at request time from the
daemon env. The real key rides `resolved_connection.env` and the runner injects it into the daemon
env (the same channel `auth.json` uses). So `models.json` on disk carries no secret value. `auth.json`
follows the same rule: `{ "openrouter": { "type": "api_key", "key": "$OPENROUTER_API_KEY" } }`,
merged with the login's copied `auth.json` so OAuth still works.

Write `models.json` only when there is something custom to say: a base URL override, or a model id
that is not in Pi's built-in catalog. For a built-in id, `auth.json` (or the env var alone) is
enough. This keeps the common case to a single small write.

## 3. How base URL and custom models reach the runner (the wire boundary)

This is the boundary decision, and it is already settled by the two siblings. Do not add a
Pi-specific field to the `/run` wire.

- The base URL rides `resolved_connection.endpoint.baseUrl`. Already on the wire
  (`wire_resolved_connection()`, `provider-model-auth` Slice 4).
- The selected model id rides `resolved_connection.model`. Already on the wire.
- The credential rides `request.secrets` (the resolved `env`). Already on the wire.

The runner **derives** `auth.json`/`models.json` from these three inputs. This is
`design-interfaces` rule 10 (separate the user-facing API from internal execution): the wire says
"here is the provider, the model, the endpoint, and the credential env"; the runner decides the Pi
file layout. The Python service stays thin. This matches `model-config` Part 3's explicit
boundary note ("derive in the runner, do not widen the wire") and the `provider-model-auth`
design's harness-adapter split.

The one field that does not fit a single run: a `custom_provider` can list many custom model ids,
but `resolved_connection.model` carries only the selected one. That is correct for the run itself
(you register the one model you are about to use). The full list matters only for the frontend
picker, which reads the vault directly (Section 5).

## 4. The `AGENTA_AGENT_MODEL_STRICT` flag (Slice 3)

`AGENTA_AGENT_MODEL_STRICT` is a **policy** field: it decides what is allowed to happen when a
requested model cannot be set (fail the run, or fall back to the harness default). It is
operator-owned and service-level, not per call. It reuses the `strict` parameter already threaded
into `applyModel` for Claude (`model.ts:57-59`), so the flag simply extends an existing policy knob
to Pi rather than inventing a mechanism.

Staged rollout, per `model-config` Part 2: default `false` (warn and fall back, today's behavior)
in the first release, then flip to `true` once the QA matrix confirms the common models are
settable and the advertised default is reconciled. The reason is a real trap: the agent config's
advertised default model is `gpt-5.5`, which the playground echoes on every run, so strict-by-default
would fail runs that never chose a model. A no-model-requested run always uses the documented
default and is never an error; only a requested-but-unsettable model fails.

The typed error `ModelNotSettableError` is **output** (system-owned): it carries the requested
model and the allowed set (from `allowedFromError` plus the fixed `allowedModels`) so the caller
learns the valid values instead of guessing. No secret ever enters it.

## 5. The picker-choices contract (Slice 4)

The picker draws model choices from two sources that play different roles and have different
owners. The current code merges only the first. The fix keeps them distinct and joins them under a
harness policy filter.

| Source | Role | Owner / lifecycle |
| --- | --- | --- |
| Static harness catalog (`capabilities[harness].models` from `GET /workflows/catalog/harnesses/`) | config/metadata | service, per Pi release, harness-scoped |
| Project vault custom-provider models (`LlmProvider.models` from `GET /secrets/`) | data | project, per edit, project-scoped |
| Harness reachability (which providers/deployments the harness can use) | policy/routing | service, per harness |

The two source lists have different owners and lifecycles, so `design-interfaces` says keep them in
two branches and join them at the read boundary, not conflate them into one bucket. Concretely:

- `buildModelOptionGroups` takes both the capability catalog and the vault entries, and produces
  grouped options. A vault custom-provider's models appear only if that provider (and its
  now-`direct` deployment) is reachable by the selected harness, the same policy filter
  `namedConnectionOptions` already applies to the Connection dropdown.
- `VaultConnectionEntry` (`connectionUtils.ts:302-312`) gains `models?: string[]`, so the array
  `transformSecret` already produces stops being dropped at the type boundary.
- Each option should carry provenance (built-in vs project connection) as **metadata**, so the UI
  can label a project-specific model and the two lists never silently collide.

Open decision recorded in [status.md](status.md): read the vault client-side (it is already
fetched on this screen via `vaultSecretsQueryAtom`, so no new endpoint) versus adding a per-project
model list to a server inspect field. The lean is client-side, consistent with the
`provider-model-auth` design ("the frontend intersects the capability table with the vault"). The
static grouped-choice baseline (`model-config` Part 3 layer 1) is independent and can land first.

## Summary of contract changes

- `ResolvedConnection.deployment` becomes a closed access-surface enum; a known-direct
  `custom_provider` normalizes to `direct` (Slice 1). No wire change.
- The runner derives Pi `auth.json`/`models.json` from `resolved_connection` plus `secrets`; the
  credential is a `"$ENV"` reference, never a raw value (Slice 2). No wire change.
- `AGENTA_AGENT_MODEL_STRICT` extends the existing `strict` policy knob to Pi; `ModelNotSettableError`
  is the typed output (Slice 3).
- `VaultConnectionEntry` gains `models?: string[]`; `buildModelOptionGroups` joins the static
  catalog and the vault under the harness policy filter, tagging provenance (Slice 4).
- The provider-to-env map value `together_ai -> TOGETHER_API_KEY`, fixed in all three copies, with
  `minimax` added where missing (Slice 0).
</content>
