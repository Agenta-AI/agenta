# Research

## Existing UI flow

`web/packages/agenta-entity-ui/src/secretProvider/CustomProviderForm.tsx` offers standard provider
kinds plus `azure`, `bedrock`, `vertex_ai`, and `custom`. The shared label for `custom` is currently
"Custom Provider" in `web/packages/agenta-entities/src/secret/core/types.ts`.

`web/packages/agenta-entities/src/secret/core/transforms.ts` writes the existing vault shape:

```json
{
  "kind": "custom_provider",
  "data": {
    "kind": "custom",
    "provider": {
      "url": "https://example.test/v1",
      "extras": {"api_key": "..."}
    },
    "models": [{"slug": "model-id"}]
  }
}
```

No schema addition is needed to retain the endpoint, key, connection name, or model IDs.

The agent model picker combines the harness catalog with custom-provider records in
`connectionUtils.ts::vaultModelGroups`. Each custom model option carries the connection slug.
`useModelHarness.tsx` writes that slug into `llm.connection.slug`. The picker currently treats
`custom` as a deployment kind and hides it from Pi because Pi publishes only `direct`.

One UI edge matters. For a bare custom model ID, the picker cannot infer a provider family from the
model string. It currently falls back to the previous provider. For the renamed
OpenAI-compatible option, it should resolve that missing family to `openai`; an explicit family
must continue to win.

## Existing service and SDK flow

`sdks/python/agenta/sdk/agents/handler.py` performs two independent checks:

1. Provider and connection mode before vault resolution.
2. Deployment after vault resolution.

This is correct for default/direct connections, but a named custom connection can use a portable
connection slug as its provider identifier. Rejecting that untrusted string before resolving the
trusted vault record prevents valid custom connections.

`sdks/python/agenta/sdk/agents/platform/connections.py` already:

- fetches the existing `GET /secrets/` list;
- selects a named custom connection by slug;
- extracts its URL, key, models, deployment, and extras;
- returns a `ResolvedConnection` with `endpoint.base_url` and `env`.

For `data.kind=custom`, the resolver has no known provider env mapping. If the model reference also
lacks a known provider, the custom API key does not enter `ResolvedConnection.env`. The minimal
normalization is:

- preserve an explicit provider family;
- otherwise map `kind=custom` to provider family `openai`;
- resolve its API key as `OPENAI_API_KEY`.

The endpoint guard currently logs and drops a blocked custom URL. That is unsafe for a named
connection because the rest of the connection can continue without its routing configuration. The
named resolve should instead raise an actionable `ConnectionResolutionError`.

## Existing wire contract

The wire already carries:

```text
model
provider
connection.mode
connection.slug
deployment
endpoint.baseUrl
credentialMode
secrets
```

`ResolvedConnection.to_wire()` excludes `env`; the secret environment travels in `secrets`. This
is the correct semantic split:

- model and provider are selection data;
- connection slug is portable intent;
- deployment and endpoint are resolved routing/configuration;
- credential mode is authentication policy;
- secrets are credentials.

Adding a Pi-specific `modelsJson`, `apiType`, or `openaiBaseUrl` field would leak harness mechanism
into a neutral boundary. It is unnecessary for the first protocol.

## Existing runner flow

`services/runner/src/engines/sandbox_agent.ts` builds a run plan, clears inherited provider
credentials for managed runs, applies exactly the resolved secrets, prepares harness assets, starts
the sandbox, creates the ACP session, and applies the requested model strictly.

Claude has a harness-specific adapter function that maps the neutral endpoint to
`ANTHROPIC_BASE_URL`. Pi has no equivalent endpoint translation.

`services/runner/src/engines/sandbox_agent/pi-assets.ts` already owns:

- local Pi agent-directory preparation;
- local extension, prompt, and skill files;
- Daytona Pi asset upload;
- the distinction between shared subscription directories and isolated managed-run directories.

The new model config belongs beside those Pi assets. It must be correctness-critical, unlike the
best-effort extension upload. If config creation fails, the run must stop before `createSession`.

Daytona receives provider secrets explicitly through `daytonaEnvVars`. `KNOWN_PROVIDER_ENV_VARS`
in `daemon.ts` is the local clear/inherit inventory, not the mechanism that permits an environment
variable to enter Daytona.

## Pi 0.80.6 behavior

The installed Pi documentation at
`services/runner/node_modules/@earendil-works/pi-coding-agent/docs/models.md` defines
`models.json` as the supported path for Ollama, LM Studio, vLLM, proxies, and other custom models.
The minimal provider entry contains:

```json
{
  "providers": {
    "provider-id": {
      "baseUrl": "https://example.test/v1",
      "api": "openai-completions",
      "apiKey": "$OPENAI_API_KEY",
      "models": [{"id": "model-id"}]
    }
  }
}
```

Pi does not expose a general `OPENAI_BASE_URL` override for this path. An arbitrary model ID must
also be registered before pi-acp can advertise it as a settable model.

The connection slug is the best Pi provider ID:

- it is stable and portable across the model reference and vault lookup;
- it prevents one custom endpoint from overriding Pi's built-in `openai` provider;
- it disambiguates identical model IDs on two custom connections;
- it is already constrained by the UI's slug validation.

## Warm session behavior

The runner's `configFingerprint` already includes model, provider, connection, deployment,
endpoint, and credential mode. A change to any custom model configuration causes a cold
environment instead of continuing a mismatched session.

The credential epoch hashes resolved secret values in memory. Rotating the key for the same slug
also causes a cold environment. No new warm-session key or persisted secret hash is required.

The implementation must still overwrite the sandbox's `models.json` with the exact current plan
before creating a fresh Pi session. It must not merge with stale custom providers from a prior use
of a reusable sandbox.

## Local endpoint behavior

The existing endpoint guard rejects HTTP and private, loopback, link-local, and reserved addresses
by default. Trusted self-hosted installations can opt in with `AGENTA_INSECURE_EGRESS_ALLOWED`.

Even with that opt-in, endpoint reachability depends on execution topology:

- Local runner: the endpoint must be reachable from the runner container/process.
- Daytona: the endpoint must be reachable from the Daytona sandbox. `localhost` refers to the
  sandbox itself.

This feature should report routing failures clearly, but it should not invent tunnels or weaken
network policy.

