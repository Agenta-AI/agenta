# Context

## Current user experience

A user can create a custom provider in the model registry with a name, base URL, API key, and one
or more model IDs. The vault stores this as a `custom_provider`. The old LLM playground can use the
record, but an agent using `pi_core` or `pi_agenta` cannot.

The agent UI already carries most of the intended connection identity. A vault model option
contains the connection slug, and selecting it writes a structured model reference. The agent
service resolves the named vault record into a model, endpoint, deployment, credential mode, and
least-privilege environment. Those values already cross the `/run` boundary.

The feature stops at the runner. Pi does not use a generic `OPENAI_BASE_URL` variable for ordinary
OpenAI-compatible models. Pi discovers custom providers and arbitrary model IDs through
`PI_CODING_AGENT_DIR/models.json`. The runner never creates that file.

## Goals

- Make an OpenAI-compatible vault connection work automatically with `pi_core` and `pi_agenta`.
- Use the existing vault secret, model reference, resolved connection, and `/run` wire fields.
- Default the existing `custom` provider kind to OpenAI Chat Completions.
- Preserve least-privilege credential delivery and current secret isolation.
- Work identically on the local and Daytona runner paths.
- Keep strict model selection: the requested custom model either runs or fails clearly.
- Keep the implementation easy to extend to Anthropic Messages without designing that extension
  now.
- Avoid changing Claude or other harness behavior as part of this feature.

## Non-goals

- No vault schema migration or new secret kind.
- No new `/run` field for provider protocol, API type, or Pi configuration.
- No generic protocol registry.
- No Anthropic Messages support in Pi in this phase.
- No OpenAI Responses support in this phase.
- No Bedrock, Vertex, Azure, or Sagemaker support in Pi.
- No automatic discovery of models from an endpoint.
- No support for unauthenticated local endpoints in the first slice. Users may use a non-secret
  placeholder API key for servers that ignore authentication.
- No attempt to make a Daytona sandbox's `localhost` refer to the runner host.

## Constraints

### Security

- Raw API keys remain in `ResolvedConnection.env` and the wire `secrets` field.
- `models.json` contains only an environment reference such as `$OPENAI_API_KEY`, never the key.
- Managed Pi runs must not write model configuration into an operator's shared subscription
  directory.
- A blocked or malformed endpoint must fail the named connection. Silently removing the endpoint
  would risk sending the request to a provider default.
- Private, loopback, and insecure HTTP endpoints remain disabled by default. Trusted single-tenant
  deployments can opt in with the existing egress setting.

### Compatibility

- Existing standard provider keys continue to use Pi's built-in model catalog and env mapping.
- Existing Claude custom-gateway handling continues to use `ANTHROPIC_BASE_URL`.
- Existing explicit provider families on custom records remain authoritative. Only a missing
  provider family on `kind=custom` defaults to `openai`.
- Unknown harnesses and unsupported provider/deployment combinations remain closed.

### Ownership

- The UI owns product labels and selection intent.
- The service owns vault resolution, semantic normalization, endpoint validation, and harness
  capability validation.
- The runner owns conversion from the neutral resolved connection into harness-native runtime
  configuration.
- Pi owns the format and behavior of `models.json`.

