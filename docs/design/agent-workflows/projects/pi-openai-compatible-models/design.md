# Design

## Overview

The existing neutral connection boundary is sufficient. The service will normalize and validate a
named custom connection. The runner will translate that resolved connection into Pi's native
configuration before Pi starts.

```text
UI selection
  -> ModelRef(model, provider, connection.slug)
  -> service resolves one vault connection
  -> ResolvedConnection + secrets
  -> existing /run request
  -> Pi adapter builds models.json
  -> local write or Daytona upload
  -> ACP session creation
  -> strict model selection
```

## Decision 1: preserve the schemas

Keep the persisted value `custom` and the existing wire fields. Change its UI label to
"OpenAI-compatible".

The first implementation has one protocol default:

```text
provider family: openai
API dialect: openai-completions
```

This is a service and runner interpretation, not a new user-authored field. It is appropriate while
the product offers only one custom API dialect. A protocol field becomes justified when the UI
offers a real second choice, such as Anthropic Messages or OpenAI Responses.

Rejected alternatives:

- **Store `openai-compatible` as a new enum value.** This creates a vault and generated-client
  migration for a label-level distinction that the current `custom` value can represent.
- **Add `api` to `/run` now.** The runner can derive the only supported value. The field would be
  future scaffolding rather than current user intent.
- **Set `OPENAI_BASE_URL`.** Pi does not use it to register arbitrary custom models.

## Decision 2: normalize provider intent in the service

For a named `custom_provider` candidate:

1. Preserve an explicit `ModelRef.provider` when it names a known family. This retains existing
   Anthropic gateway behavior.
2. If the model reference has no provider and `data.kind == "custom"`, resolve the provider family
   as `openai`.
3. Map the custom connection's API key to the resolved family's canonical env variable. The v1 Pi
   path therefore receives `OPENAI_API_KEY`.
4. Keep `deployment = "custom"`, `endpoint.base_url`, the exact model ID, and the connection slug.

The connection slug remains connection identity. It must not replace the semantic provider family
inside `ResolvedConnection.provider`.

This gives the runner both concepts without a schema change:

- `request.provider`: the API family (`openai`);
- `request.connection.slug`: the unique runtime provider ID (`my-ollama`).

## Decision 3: validate the resolved combination

Do not make `harness_allows_provider` permissive and do not add `"*"` to Pi.

For an explicit named Agenta connection, the pre-resolve check should validate the connection mode
but defer provider acceptance until the vault record is resolved. The post-resolve check then
validates the complete pair:

```text
harness + resolved provider family + resolved deployment
```

Initial allowed pairs:

| Harness | Provider | Deployment | Result |
| --- | --- | --- | --- |
| pi_core / pi_agenta | openai | direct | Existing behavior |
| pi_core / pi_agenta | openai | custom | New behavior |
| pi_core / pi_agenta | arbitrary | custom | Reject |
| claude | anthropic | direct/custom | Existing behavior |
| claude | openai | custom | Reject |
| unknown harness | any | any | Reject |

The published capability table can add `custom` to Pi's deployments so the UI can surface the
connection. Server-side pair validation remains authoritative because independent provider and
deployment lists cannot express cross-product restrictions by themselves.

This is a small extension of the existing capability mechanism, not a new policy framework.

## Decision 4: fail endpoint resolution loudly

A named custom connection requires a usable base URL. The service must fail with a typed,
actionable connection error when the URL is absent, malformed, blocked, or unresolvable under the
current egress policy.

It must not return the same connection with `endpoint=None`. Continuing would let the harness use a
default endpoint, violating the user's explicit routing choice.

The error should identify the connection slug and explain whether trusted self-hosted deployments
can use `AGENTA_INSECURE_EGRESS_ALLOWED`. It must not include the API key.

## Decision 5: isolate Pi translation in a small adapter

Add a focused runner module, for example `sandbox_agent/pi-model-config.ts`, with two layers.

### Pure planning layer

The pure builder accepts the existing request and returns either no Pi override or a validated
internal plan:

```ts
interface PiModelConfigPlan {
  providerId: string       // connection.slug
  providerFamily: "openai"
  api: "openai-completions"
  baseUrl: string
  apiKeyEnv: "OPENAI_API_KEY"
  models: Array<{id: string}>
}
```

The builder applies only when all are true:

- harness is Pi;
- deployment is `custom`;
- provider is `openai`;
- connection mode is `agenta` with a non-empty slug;
- endpoint has a base URL;
- credential mode is `env`;
- `OPENAI_API_KEY` is present in the resolved secret set;
- a model ID is present.

An incomplete applicable request is an error, not a no-op. A non-applicable request returns no
plan and follows current behavior.

The builder emits no secret values. Its `apiKeyEnv` becomes `$OPENAI_API_KEY` in JSON.

### Materialization layer

The materializer serializes one exact provider and its selected model:

```json
{
  "providers": {
    "my-ollama": {
      "baseUrl": "https://example.test/v1",
      "api": "openai-completions",
      "apiKey": "$OPENAI_API_KEY",
      "models": [{"id": "qwen2.5-coder:7b"}]
    }
  }
}
```

Rules:

- Write the exact plan. Do not merge arbitrary existing providers into a managed run.
- Use mode `0600` locally and an atomic temporary-file-plus-rename pattern where supported.
- Upload the exact JSON to `DAYTONA_PI_DIR/models.json` before `createSession` on Daytona.
- Treat write or upload failure as terminal.
- Never log the document or secret values. A log may identify the connection slug, API dialect,
  model ID, and sanitized endpoint host.

This module is Pi-specific because `models.json` is a Pi mechanism. The input remains neutral. A
generic cross-harness adapter interface would add indirection before there is a second consumer.
If Anthropic Messages later needs the same builder, extend the pure plan's `api` union and provider
mapping. If another harness needs a different mechanism, add a sibling adapter and only then
extract a shared interface.

## Decision 6: prepare managed Pi assets before session creation

### Local

A managed custom connection always requires an isolated Pi agent directory, even when there are no
skills or prompt overrides. Extend `prepareLocalPiAssets` so a Pi model-config plan is another
reason to create the throwaway directory.

Write `models.json` into that directory, point `PI_CODING_AGENT_DIR` at it, and delete it during the
existing teardown. Do not write managed model configuration into the operator's shared
subscription directory.

The implementation should reuse the existing extension/settings preparation, but it must not add
new credential copies. `models.json` references the run-scoped environment key.

### Daytona

Daytona already receives the resolved secrets as sandbox env. After the sandbox exists and before
the ACP session starts, upload `models.json` into `DAYTONA_PI_DIR` with the other Pi assets.

Overwrite any previous file. Reusable sandboxes must not retain a provider from an earlier
configuration.

## Decision 7: preserve strict selection and warm-session safety

After Pi reads `models.json`, pi-acp should advertise `<connection-slug>/<model-id>`. The existing
strict `applyModel` suffix matching can map the wire's exact model ID to that option. No custom
fallback is needed.

If Pi does not advertise it, the run fails with `ModelNotSettableError`. It must never continue on
the built-in OpenAI endpoint or a harness default.

No new keepalive fingerprint is needed:

- configuration fingerprint already covers model, provider, connection, deployment, endpoint, and
  credential mode;
- credential epoch already covers secret rotation.

Add tests that pin these assumptions so later fingerprint refactors cannot silently reuse a
mismatched session.

## Decision 8: make the UI semantic but keep it small

Change `PROVIDER_LABELS.custom` from "Custom Provider" to "OpenAI-compatible". Keep the underlying
value `custom`.

For a model selected from a `custom` connection:

- preserve a provider family encoded by the model or already stored explicitly;
- otherwise choose `openai`, not the previously selected unrelated provider;
- always preserve the selected connection slug.

Custom model visibility should require both a supported deployment and a compatible provider
family. This prevents the UI from presenting OpenAI-compatible connections to a harness that only
supports Anthropic.

Do not add an API protocol selector in this phase.

## Future protocol extension

Anthropic Messages should be added only after its product behavior is specified. It has different
model metadata, authentication, headers, compatibility details, and harness support.

The intended extension point is the pure runner plan:

```ts
type PiProviderApi = "openai-completions" | "anthropic-messages"
```

At that point:

- an explicit Anthropic provider family can map to `anthropic-messages`;
- its key can remain `ANTHROPIC_API_KEY`;
- the same local/Daytona materializers can write the resulting plan;
- capability pair validation can allow Pi plus Anthropic plus custom;
- the UI can expose a real protocol choice or provider-specific form.

If the second protocol needs user-authored compatibility, headers, or API selection, add those as
provider configuration under the vault connection at that time. Do not encode them in metadata or
add Pi-specific wire fields.

