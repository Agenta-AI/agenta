# Credential testing and model discovery

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## One Test action, two separate results

The founder-provided connection card in [experience.md](experience.md) has one Test action. It
validates the credential and fetches the model catalog together, and a timestamped line offers
re-fetch later. One action in the interface does not mean one status in the API. The API must
report two results separately:

1. **Credential test:** did the provider accept this API key?
2. **Model discovery:** which model identifiers did the provider return?

A public model endpoint can answer the second question without answering the first. Perplexity's
`GET /v1/models` is one example. It requires no authentication. A successful response cannot justify
the message `Key valid`.

The reverse can also happen. A provider may accept a credential on an account endpoint but offer no
model-list endpoint. In that case Agenta can report a valid key while keeping its existing catalog.

## Provider support

The table covers the standard provider kinds that appear in Agenta today. `Yes, authenticated`
means one free read request can validate the credential and return models. `Catalog only` means the
request returns a provider-wide catalog and does not prove access to every returned model.

| Provider | Non-generation credential test | Model refresh | Proposed behavior |
| --- | --- | --- | --- |
| OpenAI | Yes, through authenticated `GET /v1/models` | Yes | Test and refresh together. |
| Anthropic | Yes, through authenticated `GET /v1/models` | Yes | Test and refresh together. |
| OpenRouter | Yes, through authenticated `GET /api/v1/models` | Yes | Test and refresh together. Keep manual IDs available. |
| Google Gemini | Yes, through authenticated `GET /v1beta/models` | Yes | Test and refresh together. Filter by supported generation action. |
| Mistral | Yes, through authenticated `GET /v1/models` | Yes | Test and refresh together. |
| Groq | Yes, through authenticated `GET /openai/v1/models` | Yes | Test and refresh together. |
| Cohere | Yes, through authenticated `GET /v1/models` | Yes | Test and refresh together. Filter by endpoint support. |
| Together AI | Yes, through authenticated `GET /v1/models` | Yes | Test and refresh together. |
| DeepInfra | No, not through its public catalog | Catalog only through `GET /models/list` | Refresh models. Do not report that the key is valid. |
| Perplexity | No, not through its public model endpoint | Catalog only through `GET /v1/models` | Refresh models. Do not report that the key is valid. |
| MiniMax | Not confirmed in its public API reference | No confirmed list endpoint | Keep Agenta's catalog and manual IDs. Do not use paid generation as a test. |
| Aleph Alpha | Not confirmed in its current public API reference | No confirmed list endpoint | Keep Agenta's catalog and manual IDs. |
| Anyscale | No current hosted-model endpoint confirmed | No current hosted-model endpoint confirmed | Treat a user endpoint as custom. Keep manual IDs. |
| OpenAI-compatible endpoint | Not guaranteed by the compatibility label | Try `GET {base_url}/models` | A 404 or 405 means discovery is unsupported, not that the key is invalid. |

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

The MiniMax, Aleph Alpha, and Anyscale rows are explicit gaps, not claims that an endpoint cannot
exist. Implementation should add a provider adapter only after an integration test confirms the
current endpoint and authentication behavior.

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
DeepInfra, Perplexity, MiniMax, and Aleph Alpha offer no free validation, so a literal reading
blocks those providers forever. The recommended resolution lets Done enable when a key is present
and the credential status is `unknown`, with honest copy that the key was saved untested. This
needs a founder decision and is recorded in [status.md](status.md).

## Three model lists have different jobs

The implementation needs three separate concepts:

```text
provider models       models the remote endpoint reports now
recommended models    small curated list pre-checked when a connection is first created
active models         exact user choice saved on this connection
```

Provider refresh must not silently replace the active list. If a saved active model disappears
from a later refresh, settings should keep it selected and mark it unavailable. The user can then
remove it deliberately.

When discovery is unsupported or temporarily fails, Agenta must keep the shipped catalog. This
prevents the feature from reducing the model choice users have today. Users can always add a model
identifier manually, including for a standard provider such as OpenAI or OpenRouter.

## Draft recommended models

Recommended models are product policy, not a provider fact. Store them in Agenta's versioned model
catalog. Do not copy them into every connection. A missing connection selection means apply these
recommendations. A saved list, including an empty list, means use exactly what the user saved.

The interface tags these models "recommended", never "default". The connection card pre-checks them
after the first successful fetch, so a connection created through settings normally saves an
explicit list on Done. Whether Done should save that untouched pre-checked set as a pinned explicit
list, or record no explicit choice so the connection follows future recommendations, is an open
decision in [status.md](status.md).

This is a ready first draft for the eight provider families the Pi harness currently accepts from
the Agenta vault:

| Provider | Recommended model identifiers |
| --- | --- |
| OpenAI | `openai/gpt-5.5`, `openai/gpt-5.6-luna` |
| Anthropic | `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4-5` |
| Google Gemini | `gemini/gemini-3.5-flash`, `gemini/gemini-3.1-pro-preview` |
| Mistral | `mistral/mistral-medium-latest`, `mistral/mistral-small-latest` |
| Groq | `groq/openai/gpt-oss-120b`, `groq/llama-3.1-8b-instant` |
| MiniMax | `minimax/MiniMax-M3`, `minimax/MiniMax-M2.7-highspeed` |
| Together AI | `together_ai/moonshotai/Kimi-K2.7-Code`, `together_ai/openai/gpt-oss-120b` |
| OpenRouter | `openrouter/~anthropic/claude-sonnet-latest`, `openrouter/~openai/gpt-mini-latest` |

These identifiers exist in the repository's current generated Pi model catalog. They still need a
founder product decision before implementation. Providers not accepted by a harness should have no
recommended models for that harness, even if settings can store their credentials.

## Recommended first API behavior

1. Add one provider-discovery service with adapters per provider family.
2. Return credential status and discovery status separately.
3. Never send a paid generation request from the Test button.
4. Keep discovered results temporary in the first change. Save only the user's active model list.
5. Use the current Agenta catalog when discovery is unsupported or fails.
6. Accept manual model identifiers for every connection type.
7. Resolve recommended models from the harness catalog only when `models` is absent.
8. Treat `models: []` as an explicit choice to show no models from that connection.
