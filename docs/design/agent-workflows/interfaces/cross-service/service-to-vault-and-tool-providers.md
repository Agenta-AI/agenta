# Service To Vault And Tool Providers

Before the service can call the runner, it has to turn the editable agent config into
concrete, least-privilege inputs: one model connection, the resolved tool specs, and the MCP
server secrets. This is where vault keys enter the picture and where they are kept from
leaking. The run gets exactly the one connection it needs, with its secret in a dedicated
channel, and nothing more.

## The contract

The service resolves several types, each with a clear job:

- **`RuntimeAuthContext`**: the caller's `project_id` (taken from request state, never the
  body), plus the `harness` and `backend` so resolution can apply capability gates.
- **`ModelRef`**: what the config asked for. `provider`, `model`, neutral `params`, and a
  `Connection` of `mode` (`agenta` or `self_managed`) and optional `slug`.
- **`ResolvedConnection`**: what the run gets. `provider`, `model`, `deployment`,
  `credential_mode`, the secret `env` (the only secret channel, `repr=False`), and a
  non-secret `endpoint` (base url, api version, region, public headers).
- **`ToolConfig` and `ToolSpec`**: the editable tool config and its resolved runnable form.
  See [Tool models and resolution](../in-service/tool-models-and-resolution.md).
- **`ResolvedMCPServer`**: a user MCP server with its named secrets injected into `env`.

**Least privilege.** `resolve_connection(...)` builds a candidate pool from the vault
(`provider_key` and `custom_provider` secrets), filters by model then provider, picks exactly
one connection deterministically, and fails loud on ambiguity. The run never receives the
whole vault.

**Capability gating.** A resolved-pair table (`harness_allows_pair`) decides which resolved
`(provider, deployment)` pairs a harness can reach. Pi reaches its direct providers plus the
OpenAI-compatible `custom` deployment (a provider-less `custom` connection resolves to provider
`openai`, deployment `custom`); Claude reaches Anthropic across direct, custom, bedrock, and
vertex. The service checks provider and mode before resolution and deployment after, and rejects
unreachable choices server-side. The flat `deployments` lists (`["direct", "custom"]` for Pi) feed
the form and `/inspect`; the pair table is authoritative for a run. A `custom` connection with an
unusable base URL never falls back to a default endpoint. It raises `EndpointResolutionError`,
which returns HTTP 422, as do `UnsupportedProviderError` and `UnsupportedDeploymentError`.

## Owned by

- `services/oss/src/agent/app.py`: orchestrates resolution for a run.
- `sdks/python/agenta/sdk/agents/platform/resolve.py`: the resolver entrypoints.
- `sdks/python/agenta/sdk/agents/platform/connections.py`: the vault candidate logic.
- `sdks/python/agenta/sdk/agents/capabilities.py`: the harness capability table and gates.
- `services/oss/src/agent/tools/resolver.py` and `api/oss/src/apis/fastapi/tools/router.py`:
  tool resolution and execution.

## Watch for when changing

- **The secret channel.** Keys ride `env` (and the `/run` `secrets` field) and nowhere else.
  `endpoint` is non-secret by design. Do not widen the channel.
- **Single-connection selection.** Keep it deterministic and fail-loud. Silent fallback to
  the wrong key is the failure to avoid.
- **Provider env var mapping.** The provider-to-env-var map (`openai` to `OPENAI_API_KEY`,
  and so on) is what the harness reads.
- **The capability table.** It gates runs server-side and feeds the form. Drift between the
  two offers choices the run will reject.
- **Connection slug semantics.** The slug is a portable name, not a database id, so it
  survives project export and import.
