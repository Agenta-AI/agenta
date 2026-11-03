# Compatibility-first data model

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Proposed rule

Keep `provider_key` and `custom_provider` as stored record types. Make them expose the same optional
connection fields. Old records remain valid because missing fields receive defaults when read.

Do not add a third secret kind in the first change. Do not convert existing records.

## The model is general: every provider fits one of the two record shapes

The founder asked that the data model stay general enough for AWS Bedrock, Azure OpenAI, Google
Gemini, and Vertex AI, whose configuration differs from a single API key. The current storage
already supports this, and the plan keeps that split:

- **Simple API-key providers** (OpenAI, Anthropic, Gemini, Mistral, Groq, Cohere, Together AI,
  OpenRouter, DeepInfra, Perplexity, MiniMax, Anyscale) store a `provider_key` record: one
  provider family, one key. Google Gemini is already a standard kind
  (`StandardProviderKind.GEMINI`).
- **Structured-credential providers** (Azure OpenAI, AWS Bedrock, AWS SageMaker, Google Vertex AI)
  and OpenAI-compatible endpoints store a `custom_provider` record. The kinds already exist in
  `CustomProviderKind` (`azure`, `bedrock`, `sagemaker`, `vertex_ai`, `custom`), and the frontend
  already declares their field sets in
  `web/packages/agenta-entities/src/secret/core/providerFields.ts`:
  Azure needs key, endpoint URL, and API version; Bedrock needs region plus either a bearer token
  or an access-key pair; Vertex needs project, location, and service-account JSON.

What changes is presentation and shared fields, not storage: the catalog presents all of these as
one provider list, the connection card renders the field set for the chosen provider kind, and both
record types gain the same optional `models` and `harnesses` fields. The connection card is
schema-driven by provider kind, so adding a future provider with unusual credentials means adding a
field set, not a record type.

One cleanup belongs to this work: the credential "extras" vocabulary (for example
`aws_region_name`, `vertex_ai_project`) is currently declared independently in the frontend
transforms, the prompt-path resolver, and the agent-path resolver. The implementation must treat
the frontend field catalog and the SDK alias maps as one reviewed vocabulary so a field saved by
the card is understood by every run path.

## Standard provider record

```json
{
  "kind": "provider_key",
  "slug": "openai-team-019f",
  "header": {"name": "OpenAI team key"},
  "data": {
    "kind": "openai",
    "provider": {"key": "..."},
    "models": [{"slug": "gpt-5.6-luna"}, {"slug": "gpt-5.6-sol"}],
    "harnesses": ["pi_core", "codex"]
  }
}
```

`models` missing means use Agenta's default models for this provider and harness. `models` present
means use the saved list. An empty list means show no models from this connection. This keeps an
explicit user choice distinct from a record that predates model selection.

The settings card pre-checks the default models after the first successful fetch, and Done saves
that set as an explicit list (decision recorded in [status.md](status.md)). The missing-`models`
path then mainly serves records created before this feature and records created through the API
without a list.

`harnesses` missing means use Agenta's technical compatibility. `harnesses` present means apply the
saved subset. The effective harnesses are always the intersection of the saved list and Agenta's
technical compatibility.

## Custom-provider record

Keep its current shape and add `harnesses` with the same meaning. Its existing `models` field remains
the connection-owned model list. Azure, Bedrock, SageMaker, Vertex, and OpenAI-compatible
connections continue to store their structured credentials in the existing `provider` settings and
`extras` fields.

## Connection identity

Every stored provider connection needs:

- `id`: database identity.
- `slug`: stable portable identity used by saved agent configuration.
- `header.name`: user-facing display name.
- provider family: the model provider, such as `openai` or `anthropic`.

The resolver must select both standard and custom connections by slug. Provider family alone may
choose a default only when exactly one matching connection exists or an explicit default rule exists.

## Default connection names

The display name does not define connection identity. The stable slug does.

When the user leaves the name empty, the API assigns the provider's display name to the first
connection and adds a number for later connections:

```text
OpenAI
OpenAI 2
OpenAI 3
```

The API must calculate the next available name within the project. The frontend may preview the
name, but it must not become the authority because two clients can create connections at the same
time. A user-provided name remains unchanged unless it conflicts with a project-level naming rule.

## Normalized read model

Backend and frontend code should normalize both stored types into one application concept:

```python
class ProviderConnection:
    id: str
    slug: str
    name: str
    provider: str
    connection_kind: str
    deployment: str
    endpoint: Optional[Endpoint]
    credential_fields: dict      # provider-kind-specific, never returned unredacted
    models: Optional[list[Model]]
    allowed_harnesses: Optional[list[str]]
```

Credentials remain protected by the existing vault response and frontend redaction behavior. This
read model does not turn subscription detection into a stored connection.

## Every consumer resolves the same concept

Three run paths consume provider connections today, through two different resolvers:

1. Agent runs resolve vault records in
   `sdks/python/agenta/sdk/agents/platform/connections.py`.
2. Prompt, completion, and chat runs resolve credentials in
   `sdks/python/agenta/sdk/managers/secrets.py` by mapping the chosen model back to a provider
   family.
3. LLM-as-a-judge runs use the same `SecretsManager` path as prompt runs.

The connection concept above is the contract for all three. In particular, resolution by stable
slug (not by provider family, not by display name) is what lets two OpenAI connections coexist for
every run path. See [plan.md](plan.md) for the wiring work per path.

## Model discovery

Model discovery is an action on a connection. The provider credential and endpoint determine where
Agenta asks for models. The result is not the same as the saved active list.

```text
Provider returns available models
             ↓
User chooses active models
             ↓
Connection stores active models
```

The first API change can store and return active model lists without implementing provider
discovery. A later settings change can add discovery for supported providers and manual entry for
the rest. Discovery results must not overwrite the saved list. See `provider-discovery.md` for the
fallback and default rules.
