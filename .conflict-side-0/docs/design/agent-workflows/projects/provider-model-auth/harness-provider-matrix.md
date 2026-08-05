# Harness provider/auth matrix (the data behind `/inspect`)

The real provider/model/auth facts for the two harnesses, extracted from the vendored Pi SDK and
Claude Code, mapped onto Agenta's vault secret kinds. This is the source data for the per-harness
capability surface that `/inspect` publishes so the frontend can filter the project's stored
secrets to the ones the selected harness can actually use.

Pi facts cited from the vendored SDK
`services/agent/node_modules/.pnpm/@earendil-works+pi-ai@0.79.4_*/node_modules/@earendil-works/pi-ai/dist/`
(`env-api-keys.js`, `providers/register-builtins.js`, `types.d.ts`). Agenta vault kinds from
`api/oss/src/core/secrets/enums.py`.

## Pi providers that map to an Agenta vault secret

These are the providers a user's stored vault secret can drive on Pi. (Pi knows ~35 providers
total; the rest have no Agenta vault kind and are out of scope unless a `custom_provider` secret is
created for them.)

| Pi provider id | Pi api-key env var | Agenta vault kind | Notes |
| --- | --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | `provider_key` openai | `openai-codex` is a separate Pi provider sharing `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` (or `ANTHROPIC_OAUTH_TOKEN`, OAuth wins) | `provider_key` anthropic | |
| `google` | `GEMINI_API_KEY` | `provider_key` gemini | Gemini via the Google Generative AI API |
| `mistral` | `MISTRAL_API_KEY` | `provider_key` mistral | |
| `groq` | `GROQ_API_KEY` | `provider_key` groq | |
| `minimax` | `MINIMAX_API_KEY` | `provider_key` minimax | |
| `together` | `TOGETHER_API_KEY` | `provider_key` together_ai | **Existing bug:** `_PROVIDER_ENV_VARS` emits `TOGETHERAI_API_KEY`; Pi reads `TOGETHER_API_KEY`. (model-config owns the fix.) |
| `openrouter` | `OPENROUTER_API_KEY` | `provider_key` openrouter | |
| `azure-openai-responses` | `AZURE_OPENAI_API_KEY` + base_url + api_version | `custom_provider` azure | complex: needs endpoint config, not just a key. **Pi consumption staged with model-config (v1: fail loud)** |
| `amazon-bedrock` | AWS creds (no single key) | `custom_provider` bedrock | complex: see cloud creds below. **Pi consumption staged with model-config (v1: fail loud)** |
| `google-vertex` | `GOOGLE_CLOUD_API_KEY` or ADC | `custom_provider` vertex_ai | complex: see cloud creds below. **Pi consumption staged with model-config (v1: fail loud)** |

`StandardProviderKind`s in the vault that Pi does NOT have in its env-key map (so a plain
`provider_key` of these does not drive Pi today): cohere, anyscale, deepinfra, alephalpha,
perplexityai, mistralai (legacy alias of mistral). These are LiteLLM/completion-path providers.

**Pi cloud/custom-endpoint consumption is NOT generic in v1.** Pi has the bedrock/vertex/azure env +
model facts above, but the Agenta runner does not register Pi provider/model config and explicitly
ignores `endpoint.baseUrl` (`services/agent/src/engines/pi.ts:309`). So in v1 the **resolver emits**
the full cloud env set and the runner **clear-then-applies** it, but Pi **consuming** a custom
endpoint or a cloud deployment (registering the Pi provider plus `models.json`) **stages with the
[../model-config/](../model-config/) sibling as a prerequisite** — the same fail-loud posture as
Claude Bedrock/Vertex. Direct api-key providers (the eight above) are the v1 Pi reach.

## Claude Code

Reaches **anthropic only**. Three ways: direct (`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` /
`CLAUDE_CODE_OAUTH_TOKEN`), a custom gateway (`ANTHROPIC_BASE_URL`), or Anthropic-on-Bedrock /
Anthropic-on-Vertex (`CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` + the cloud creds below).
The runner wires direct + custom base_url today; Bedrock/Vertex on Claude are **not wired in v1**
(fail loud). Usable Agenta vault kind: `provider_key` anthropic (and, later, the Anthropic
`custom_provider` bedrock/vertex). Model selection is by alias (`default`/`sonnet`/`opus`/`haiku`
and `[1m]` variants), not `provider/model`.

## Complex cloud credentials (the multi-variable cases the runner must carry)

These are why a single `*_API_KEY` env var is insufficient. The resolver must emit the FULL set for
the connection, and the runner clears a complete known-provider-env inventory (every `*_API_KEY` plus
the full `AWS_*`/`GOOGLE_*`/ADC/`AZURE_*` groups) and then applies whatever the resolver sent — the
resolver's `env` is the apply set, not the clear set. (Pi *consuming* these cloud env groups stages
with model-config, as noted above; the resolver emit + runner clear-then-apply are v1.)

| Deployment | Pi env it needs | Claude env it needs | Non-secret endpoint config |
| --- | --- | --- | --- |
| Bedrock | `AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY` (+`AWS_SESSION_TOKEN`), or `AWS_PROFILE`, or `AWS_BEARER_TOKEN_BEDROCK`; region (**Pi consumption staged with model-config, v1: fail loud**) | `CLAUDE_CODE_USE_BEDROCK=1` + the same AWS creds (v1: not wired) | `AWS_REGION` / `AWS_DEFAULT_REGION` |
| Vertex | `GOOGLE_APPLICATION_CREDENTIALS` (ADC) + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION`, or `GOOGLE_CLOUD_API_KEY` (**Pi consumption staged with model-config, v1: fail loud**) | `CLAUDE_CODE_USE_VERTEX=1` + same (v1: not wired) | project, location |
| Azure | `AZURE_OPENAI_API_KEY` (**Pi consumption staged with model-config, v1: fail loud**) | n/a (Claude reaches anthropic only) | base_url, api_version |

## What `/inspect` publishes per harness (the bottom line)

This document is published in the `/inspect` response **`meta`** (or an explicitly-extended inspect
contract), **not** as a fourth `AGENT_SCHEMAS` schema key (`JsonSchemas` allows only
`inputs`/`parameters`/`outputs`). The agent service imports the same SDK capability table for its
server-side reject rather than calling its own `/inspect`.

```
pi:     providers = [openai, anthropic, google/gemini, mistral, groq, minimax, together_ai,
                     openrouter, openai-codex]   (+ the ~24 no-vault-kind providers Pi also reaches)
                  // openai-codex = OpenAI's ChatGPT/Codex subscription; reached via an OAuth login
                  // (no vault provider_key), so it is usable under self_managed and the agenta
                  // default's runtime_provided fallback. Models (gpt-5.5/gpt-5.4/gpt-5.4-mini) are
                  // carried explicitly in capabilities.py since the litellm catalog omits them.
        deployments = [direct]   (azure, bedrock, vertex declared; Pi consumption staged with
                                  model-config -> fail loud in v1)
        connection_modes = [agenta, self_managed]
        model selection = provider/id (exact)

claude: providers = [anthropic]
        deployments = [direct]   (bedrock, vertex declared but not wired in v1 -> fail loud)
        connection_modes = [agenta, self_managed]
        model selection = alias (default/sonnet/opus/haiku, [1m])
```

The frontend intersects this with `GET /vault/connections` (the project's stored secrets read as
connections): for the selected harness, show only the connections whose `provider`/`deployment` is
in the harness's `providers`/`deployments`. That is "filter which secrets to use."
