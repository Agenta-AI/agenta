# Model Connection Resolution

The agent config says which model to run. This contract turns that into one least-privilege
connection: the run gets exactly the credential it needs and nothing else. It is also where
harness capability gating lives, so an unreachable provider or deployment is rejected before
the run starts. The cross-service view is in
[Service to vault and tool providers](../cross-service/service-to-vault-and-tool-providers.md);
this page is the in-service model side.

## The contract

**`ModelRef`** is what the config asked for: `provider`, `model`, neutral `params`, and a
`Connection` of `mode` (`agenta` or `self_managed`) and optional `slug`. A plain string model
parses into a `ModelRef` with no connection; a structured `{provider, model, connection}`
parses into a full one.

**`ResolvedConnection`** is what the run gets:

```jsonc
{
  "provider": "openai",
  "model": "gpt-5.5",              // possibly rewritten for the deployment
  "deployment": "direct",          // direct | azure | bedrock | vertex_ai | custom
  "credential_mode": "env",        // env | runtime_provided | none
  "env": { "OPENAI_API_KEY": "..." },   // the only secret channel (repr=False)
  "endpoint": {                    // non-secret connection config
    "base_url": null, "api_version": null, "region": null, "headers": {}
  }
}
```

**Resolution** builds a candidate pool from the vault (`provider_key` and `custom_provider`
secrets), filters by exact model then by provider family, and picks one connection: by slug
if named, else the single candidate, else one named `default`, else it raises on ambiguity.
The run receives only that candidate's `env` and `endpoint`. It never receives the whole
vault.

**Capability gating** runs in two halves around resolution. Provider and connection mode are
checked before; deployment is checked after (the resolved connection is what carries it). A
resolved-pair table (`harness_allows_pair`) is authoritative: Pi reaches its direct providers
plus the OpenAI-compatible `custom` deployment (a provider-less `custom` connection resolves to
provider `openai`, deployment `custom`); Claude reaches Anthropic across direct, custom, bedrock,
and vertex. Unnamed default connections degrade tolerantly to an empty `env` rather than failing
the run. A `custom` connection with an unusable base URL is the exception: it never resolves to a
default endpoint. It raises `EndpointResolutionError`, which returns HTTP 422.

## Owned by

- `services/oss/src/agent/app.py`: orchestrates resolution and the capability checks.
- `sdks/python/agenta/sdk/agents/connections/`: `ModelRef`, `Connection`, `ResolvedConnection`.
- `sdks/python/agenta/sdk/agents/platform/resolve.py` and `platform/connections.py`: the
  resolver and the vault candidate logic.
- `sdks/python/agenta/sdk/agents/capabilities.py`: the harness capability table and gates.

## Watch for when changing

- **Provider and deployment support per harness.** The table gates runs and feeds the form.
- **Single-connection selection.** Keep it deterministic and fail-loud on ambiguity.
- **The tolerant default path.** Unnamed `agenta`/`self_managed` connections degrade to empty
  `env`; that is deliberate, so do not turn it into a hard failure by accident.
- **The secret channel.** `env` carries the key; `endpoint` is non-secret. Do not mix them.
