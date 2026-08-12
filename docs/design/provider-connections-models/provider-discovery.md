# Credential testing and model discovery

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## One Test action, two separate results

The founder-provided connection card in [experience.md](experience.md) has one Test action. It
validates the credential and fetches the model catalog together, and a timestamped line offers
re-fetch later. One action in the interface does not mean one status in the API. The API must
report two results separately:

1. **Credential test:** did the provider accept this credential?
2. **Model discovery:** which model identifiers did the provider return?

A public model endpoint can answer the second question without answering the first. Perplexity's
`GET /v1/models` is one example. It requires no authentication. A successful response cannot justify
the message `Key valid`.

The reverse can also happen. A provider may accept a credential on an account endpoint but offer no
model-list endpoint. In that case Agenta can report a valid key while keeping its existing catalog.

## Provider support

The table covers the provider kinds the catalog offers. `Yes, authenticated` means one free read
request can validate the credential and return models. `Catalog only` means the request returns a
provider-wide catalog and does not prove access to every returned model.

Aleph Alpha is removed from the catalog. The company is defunct. Existing stored Aleph Alpha
records keep resolving so old configurations do not break, but the catalog no longer offers the
provider.

AWS Bedrock, Azure OpenAI, and Google Vertex AI join the catalog as first-class providers. Their
credentials are not a single API key, so their connection cards collect provider-specific fields.
The current custom-provider record type already stores those fields today; see
[data-model.md](data-model.md).

| Provider | Credential shape | Non-generation credential test | Model refresh | Proposed behavior |
| --- | --- | --- | --- | --- |
| OpenAI | API key | Yes, through authenticated `GET /v1/models` | Yes | Test and refresh together. |
| Anthropic | API key | Yes, through authenticated `GET /v1/models` | Yes | Test and refresh together. |
| OpenRouter | API key | Yes, through authenticated `GET /api/v1/models` | Yes | Test and refresh together. Keep manual IDs available. |
| Google Gemini | API key | Yes, through authenticated `GET /v1beta/models` | Yes | Test and refresh together. Filter by supported generation action. |
| Google Vertex AI | Service-account JSON, project, location | Yes, an authenticated publisher-model list request | Yes | Test and refresh together. Requires OAuth token exchange from the service-account credentials. |
| AWS Bedrock | Region plus bearer token, or access key ID and secret | Yes, through authenticated `ListFoundationModels` | Yes | Test and refresh together. The request is free and read-only. |
| Azure OpenAI | API key, endpoint URL, API version | Yes, through an authenticated deployments or models read on the user's endpoint | Yes | Test and refresh together. Azure lists the user's own deployments, so the result is account-specific, not a public catalog. |
| Mistral | API key | Yes, through authenticated `GET /v1/models` | Yes | Test and refresh together. |
| Groq | API key | Yes, through authenticated `GET /openai/v1/models` | Yes | Test and refresh together. |
| Cohere | API key | Yes, through authenticated `GET /v1/models` | Yes | Test and refresh together. Filter by endpoint support. |
| Together AI | API key | Yes, through authenticated `GET /v1/models` | Yes | Test and refresh together. |
| DeepInfra | API key | No, not through its public catalog | Catalog only through `GET /models/list` | Refresh models. Do not report that the key is valid. |
| Perplexity | API key | No, not through its public model endpoint | Catalog only through `GET /v1/models` | Refresh models. Do not report that the key is valid. |
| MiniMax | API key | Not confirmed in its public API reference | No confirmed list endpoint | Keep Agenta's catalog and manual IDs. Do not use paid generation as a test. |
| Anyscale | API key | No current hosted-model endpoint confirmed | No current hosted-model endpoint confirmed | Treat a user endpoint as custom. Keep manual IDs. |
| OpenAI-compatible endpoint | API key plus base URL | Not guaranteed by the compatibility label | Try `GET {base_url}/models` | A 404 or 405 means discovery is unsupported, not that the key is invalid. |

Official references:

- [OpenAI Models API](https://platform.openai.com/docs/api-reference/models/object?lang=curl)
- [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list)
- [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)
- [Google Gemini Models API](https://ai.google.dev/api/models)
- [Mistral Models API](https://docs.mistral.ai/api/endpoint/models)
- [Groq Models API](https://console.groq.com/docs/models)
- [Cohere Models API](https://docs.cohere.com/reference/list-models)
- [Together AI Models API](https://docs.together.ai/reference/models)
- [DeepInfra model catalog](https://docs.deepinfra.com/api-reference/models/models-list)
- [Perplexity OpenAI compatibility](https://docs.perplexity.ai/docs/agent-api/openai-compatibility)
- [AWS Bedrock ListFoundationModels](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListFoundationModels.html)
- [Azure OpenAI deployments](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/working-with-models)
- [Vertex AI publisher models](https://cloud.google.com/vertex-ai/docs/reference/rest)

The MiniMax and Anyscale rows are explicit gaps, not claims that an endpoint cannot exist.
Implementation should add a provider adapter only after an integration test confirms the current
endpoint and authentication behavior.

## Manual model IDs are always available

Every connection allows manual model identifiers, regardless of provider and regardless of whether
discovery succeeded, failed, or is unsupported. Discovery is a convenience on top of manual entry,
never a gate in front of it. This rule also resolves the providers with no free credential test:
the user can always type the model identifiers they know they have access to and save the
connection.

## OpenAI compatibility is not enough

An OpenAI-compatible endpoint usually promises a compatible generation request. It does not always
promise the complete OpenAI management API. Agenta should try the standard model path, then preserve
manual setup when the server does not implement it.

The backend should normalize each provider adapter into this result:

```json
{
  "credential": {"status": "valid|invalid|unknown", "message": "..."},
  "discovery": {"status": "fetched|unsupported|failed", "models": []},
  "fetched_at": "2026-08-12T00:00:00Z"
}
```

`unknown` is a useful and honest result. It means Agenta found no safe, free read endpoint that
proves the key works. The UI should say `Model list refreshed. Key not tested`, not `Key valid`.

The `unknown` status collides with one card rule. The design disables Done until the key is valid.
DeepInfra, Perplexity, and MiniMax offer no free validation, so a literal reading blocks those
providers forever. Resolution (decision taken during the review pass, recorded in
[status.md](status.md)): Done enables when a credential is present and the credential status is
`unknown`, with honest copy that the key was saved untested.

## Three model lists have different jobs

The implementation needs three separate concepts:

```text
provider models    models the remote endpoint reports now
default models     small curated list pre-checked when a connection is first created
active models      exact user choice saved on this connection
```

Provider refresh must not silently replace the active list. If a saved active model disappears
from a later refresh, settings should keep it selected and mark it unavailable. The user can then
remove it deliberately.

When discovery is unsupported or temporarily fails, Agenta must keep the shipped catalog. This
prevents the feature from reducing the model choice users have today. Users can always add a model
identifier manually, including for a standard provider such as OpenAI or OpenRouter.

## Default models

The founder confirmed the term "default models" for the curated pre-checked list: they are the
models that are selected per default. An earlier draft called them "recommended models"; that term
is retired.

Default models are product policy, not a provider fact. Store them in Agenta's versioned model
catalog. Do not copy them into every connection. A missing connection selection means apply the
defaults. A saved list, including an empty list, means use exactly what the user saved.

The connection card pre-checks the default models after the first successful fetch, and Done saves
that set as the connection's explicit active list (decision recorded in [status.md](status.md)).

The founder corrected the identifier lists on 2026-08-12. Every identifier below exists in the
repository's generated Pi model catalog, with one noted exception:

| Provider | Default model identifiers |
| --- | --- |
| OpenAI | `openai/gpt-5.6-luna`, `openai/gpt-5.6-terra`, `openai/gpt-5.6-sol` |
| Anthropic | `anthropic/claude-fable-5`, `anthropic/claude-opus-5`, `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4-5` |
| Google Gemini | `gemini/gemini-3.5-flash`, `gemini/gemini-3.1-pro-preview` |
| Mistral | `mistral/mistral-medium-latest`, `mistral/mistral-small-latest` |
| Groq | `groq/openai/gpt-oss-120b`, `groq/llama-3.1-8b-instant` |
| MiniMax | `minimax/MiniMax-M3`, `minimax/MiniMax-M2.7-highspeed` |
| Together AI | `together_ai/moonshotai/Kimi-K2.7-Code`, `together_ai/zai-org/GLM-5.2` |
| OpenRouter | `openrouter/z-ai/glm-5.2`, `openrouter/deepseek/deepseek-v4-flash`, `openrouter/deepseek/deepseek-v4-pro`, `openrouter/openai/gpt-5.6-luna`, `openrouter/xiaomi/mimo-v2.5`, `openrouter/tencent/hy3` |

Notes on the corrected lists:

- The OpenRouter list follows the current OpenRouter usage rankings (August 2026): DeepSeek V4
  Flash and Pro, GPT-5.6 Luna, MiMo v2.5, GLM-5.2, and Tencent HY3 lead the trailing-month token
  volume. This replaces the earlier draft that used floating `~vendor` aliases.
- `anthropic/claude-opus-5` does not exist in the pinned Pi catalog yet; the catalog tops out at
  `anthropic/claude-opus-4-8` because the pinned `@earendil-works/pi-ai` version predates Opus 5.
  Implementation must refresh the generated catalog (the `sync-model-catalog` skill owns this)
  before that identifier resolves. Until then the effective Anthropic default falls back to the
  three identifiers that exist.
- Azure OpenAI, AWS Bedrock, Vertex AI, and OpenAI-compatible endpoints have no fixed default
  list. Their model identifiers are account-specific (deployments, enabled foundation models), so
  their cards rely on discovery plus manual entry, and nothing is pre-checked.

Providers not accepted by a harness should have no default models for that harness, even if
settings can store their credentials.

## Recommended first API behavior

1. Add one provider-discovery service with adapters per provider family.
2. Return credential status and discovery status separately.
3. Never send a paid generation request from the Test button.
4. Keep discovered results temporary in the first change. Save only the user's active model list.
5. Use the current Agenta catalog when discovery is unsupported or fails.
6. Accept manual model identifiers for every connection type, always.
7. Resolve default models from the versioned catalog only when `models` is absent.
8. Treat `models: []` as an explicit choice to show no models from that connection.
