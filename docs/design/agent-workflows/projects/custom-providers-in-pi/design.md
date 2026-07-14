# Design: the contracts, classified by role

This plan touches four contracts. Each one runs through the `design-interfaces` pass: what the field
is, who owns it, when it changes, and which semantic role it plays (data, config, policy,
credentials, routing, metadata, or protocol context). The point is to fix the shape while it is on
paper. The one rule: classify a field by the role it plays, not the feature it touches.

Two of these contracts already landed in part. This doc marks what is settled and what this plan
adds.

## 1. The `deployment` field and the OpenAI-compatible family

### What it is

`deployment: Deployment = "direct"` on `ResolvedConnection` (`connections/models.py:178`). It answers
"which access surface and auth mechanism does the harness use to reach this model." It is a
routing field, service-derived, and it changes per connection, never per call. Pi advertises
`deployments=["direct"]` today, and `harness_allows_deployment` (`capabilities.py:299-310`) gates a
run against that set.

### What landed

A custom connection whose kind is a known provider family now resolves to `deployment="direct"`
(`connections.py:330-335`, `deployment = "direct" if provider is not None else provider_kind`). Its
base URL rides `endpoint`, its key rides `env`. A custom OpenRouter or OpenAI connection passes Pi's
gate with no other change. This is correct and it stays.

### What this plan adds: the named OpenAI-compatible connection

A connection whose kind is not a known family (an Ollama gateway, an in-house proxy) resolves with
`provider=None`, so it keeps `deployment=provider_kind` and Pi rejects it. The requirement is a
**named OpenAI-compatible connection**, not a known family disguised as custom. The fix, by role:

- Keep `deployment="custom"` for a record whose kind is not a known family. "Custom" is a real access
  surface here: a single bearer key sent to an OpenAI-completions endpoint at an operator-named base
  URL. It is not one of the built-in direct providers, and it is not a cloud surface.
- After the trusted vault record resolves, default a provider-less custom record to the
  OpenAI-compatible family. This is a service-side default on an already-resolved, trusted record. It
  needs no stored-schema change and no vault write.
- Add the `custom` deployment to Pi's capability row, paired with the OpenAI-compatible protocol. Pi
  then allows the `(custom, openai-compatible)` pair explicitly, so a named connection reaches the
  runner instead of dying at the gate.

The known-family `direct` normalization is untouched. This section adds the missing branch: an
unknown kind is a named OpenAI-compatible endpoint, resolved to `deployment="custom"` and the
OpenAI-compatible family, which Pi allows.

Rejected alternative: add every unknown kind to Pi's `deployments` as a distinct surface, or force
each named endpoint into `direct`. The first turns the capability table into a registry of user
strings. The second erases the difference between a built-in provider and an operator-named endpoint,
which is exactly the difference the slug needs to preserve (Section 3).

## 2. The Pi `models.json` shape and the model-config builder

The runner writes this file into the per-run Pi agent dir. It is Pi's own config format, so the outer
shape is fixed by Pi. The `design-interfaces` work is on how each value is sourced, that the
credential is a reference and not a secret, and that the map is keyed by a stable identity.

```json
{
  "providers": {
    "my-ollama-gateway": {
      "baseUrl": "https://gateway.internal/v1",
      "api": "openai-completions",
      "apiKey": "$CONNECTION__MY_OLLAMA_GATEWAY__API_KEY",
      "models": [{ "id": "llama-3.1-70b" }]
    }
  }
}
```

| Field | Role | Owner / lifecycle | Source in our contract |
| --- | --- | --- | --- |
| `providers` | config, extensible map | service, per run | keyed by the connection **slug**, not the provider |
| `providers.<slug>.baseUrl` | routing (the endpoint being contacted) | service, per run | `resolved_connection.endpoint.baseUrl` |
| `providers.<slug>.api` | protocol context (the wire dialect) | service, per run | fixed `openai-completions` in v1 |
| `providers.<slug>.apiKey` | credentials, expressed as an env **reference** | service, per run | `"$" + env_var`, never the raw key |
| `providers.<slug>.models[].id` | config/data (the registered model) | service, per run | `resolved_connection.model` (the selected id) |

### Key by slug, not provider

Two custom connections can both resolve to the OpenAI-compatible family, and a provider-less one may
carry no provider at all. Keying `providers` by `resolved_connection.provider` would collide or fail
to produce a Pi provider id. Key by the connection slug. Each connection gets a stable, unique Pi
identity, and the selected model registers under that entry. This is the reason the wire gains a slug
(Section 3).

### The dialect is `openai-completions` only in v1

`api` is protocol context: it tells Pi which request and response semantics to use. In v1 it is
strictly `openai-completions`. Do not infer `anthropic-messages` from a provider label. Anthropic
Messages has materially different request and response semantics and must not be half-supported. The
builder exposes a protocol discriminator so a later version can add another dialect, and v1 rejects
any unsupported protocol loudly rather than guessing.

### The credential is a reference

`design-interfaces` rule 8: prefer a reference over a raw secret. `apiKey` is written as a `"$ENV"`
interpolation Pi resolves at request time from the daemon or sandbox environment. The real key rides
`resolved_connection.env` and the runner injects it into that environment. So `models.json` on disk
carries no secret value.

### The builder returns files plus the exact model id

The model-config builder is a small pure function. It returns two things:

```
{ files: { "models.json": <content> }, exactModelId: "<slug>/<model>" }
```

`exactModelId` is the fully qualified Pi id, `<slug>/<model>`. The runner passes that exact id to
`setModel`. This bypasses the suffix-match fallback in `pickModel` (`model.ts:49-59`), which can pick
the wrong provider when two providers share a model suffix. The wire keeps the bare selected model id
(Section 3); the runner derives the qualified id.

### The isolated managed directory

For a managed run (`credentialMode="env"`), the runner must not reuse the operator's personal login.
`prepareLocalAgentDir` (`pi-assets.ts:475-490`) copies the operator's `auth.json` and `settings.json`
today, which would let a managed run authenticate with an operator subscription or the wrong
provider. The Daytona path already refuses to copy a personal `auth.json` (`daytona.ts:168-171`); the
local path must match it. The runner builds an isolated managed Pi directory that carries only
non-credential settings plus `models.json` with the `"$ENV"` apiKey reference. The raw key stays
solely in the daemon or sandbox environment. This fixes the existing local managed path, not only the
new custom-provider case.

## 3. The wire boundary: exactly one new field

The first plan promised no new wire field. Keying `models.json` by slug makes that impossible: the
runner cannot reconstruct the connection slug from `provider`, `model`, `deployment`, and `endpoint`.
So the wire gains exactly one field, and no more.

| Field | Role | Owner / lifecycle | Notes |
| --- | --- | --- | --- |
| `slug` on `ResolvedConnection.to_wire()` | identity / metadata | the vault record; changes per connection edit | the connection's stable name; the Pi `providers` key |

Everything else the runner still derives:

- The base URL rides `resolved_connection.endpoint.baseUrl`. Already on the wire.
- The selected model id rides `resolved_connection.model`. Already on the wire. The runner derives
  `<slug>/<model>` (Section 2).
- The credential rides `request.secrets` (the resolved `env`). Already on the wire.

The runner derives `models.json` and the exact model id from the slug plus these three inputs. This
keeps `design-interfaces` rule 10 (separate the user-facing API from internal execution): the wire
says "here is the connection identity, the model, the endpoint, and the credential env"; the runner
decides the Pi file layout.

Note the docstring on `ResolvedConnection` states the harness adapter "never sees a vault, a
connection, or a slug." That sentence changes with this plan. The slug is not a secret; it is the
connection's identity, and it must reach the runner for the `models.json` key to be stable. Update
the docstring alongside the field.

## 4. Fail-loud on an unsettable model (already landed)

This contract landed already, so this plan mostly inherits it. `AGENTA_AGENT_MODEL_STRICT` is a
policy field: it decides what happens when a requested model cannot be set (fail the run, or fall
back to the harness default). It is operator-owned and service-level. It shipped wired for every
harness and defaulting to true (`modelResolutionStrict` at `sandbox_agent.ts:374`), which diverges
from the first plan's staged rollout (default false, flip later). The staged flip is moot.

The typed error `ModelNotSettableError` (`model.ts:9`) is output, system-owned: it carries the
requested model and the allowed set so the caller learns the valid values instead of guessing. No
secret enters it.

There is no separate `engines/pi.ts`; the single `sandbox_agent` engine's `model.ts` is the shared
path for both Pi and Claude, so both already raise the typed error under strict. The only
model-correctness work left is Section 2's exact-id derivation, which removes the suffix fallback's
wrong-provider risk. That work lives in the runner slice, not here.

## 5. The UI change: rename the type label only

The model picker expansion is out of scope for this plan. It moves to the `model-config` sibling
(Part 3), which owns the model-choice surface. The `VaultConnectionEntry` symbol the first plan named
for this change does not exist in `web/`; it was a stale name.

The UI change in this plan is exactly one thing. Rename the visible type "Custom provider" to
"OpenAI-compatible endpoint" at three locations:

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSection.tsx:87`
  and `:416`.
- `web/packages/agenta-entities/src/secret/core/types.ts:98`.
- `web/oss/src/components/pages/settings/Secrets/SecretProviderTable/index.tsx:206`.

The existing UI already creates the record and sends its selected connection and model. Nothing else
in the picker changes here.

## Summary of contract changes

- `ResolvedConnection.deployment`: known-family custom is `direct` (landed). A provider-less or
  unknown-kind custom keeps `deployment="custom"` and defaults to the OpenAI-compatible family
  post-resolve; Pi's capability row allows the `(custom, openai-compatible)` pair.
- The runner derives Pi `models.json`, keyed by `providers[<slug>]`, dialect `openai-completions` in
  v1 (with a protocol discriminator for later), `apiKey` as a `"$ENV"` reference, one selected model.
  The builder returns the files and the exact `<slug>/<model>` id, which the runner sets directly.
- The runner builds an isolated managed Pi directory on the local path (no operator `auth.json` on a
  managed run), matching the Daytona path.
- The wire gains exactly one field: `slug` on `ResolvedConnection.to_wire()`.
- Fail-loud on an unsettable model already landed (strict-by-default, typed `ModelNotSettableError`).
- The UI renames the type label "Custom provider" to "OpenAI-compatible endpoint" at three locations.
  The picker expansion moves to `model-config` Part 3.
