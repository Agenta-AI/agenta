# Compatibility-first data model

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Proposed rule

Keep `provider_key` and `custom_provider` as stored record types. Make them expose the same optional
connection fields. Old records remain valid because missing fields receive defaults when read.

Do not add a third secret kind in the first change. Do not convert existing records.

## Standard provider record

```json
{
  "kind": "provider_key",
  "slug": "openai-team-019f",
  "header": {"name": "OpenAI team key"},
  "data": {
    "kind": "openai",
    "provider": {"key": "..."},
    "models": [{"slug": "gpt-5.6"}, {"slug": "gpt-5.6-luna"}],
    "harnesses": ["pi_core", "codex"]
  }
}
```

`models` missing means use Agenta's default-active models for this provider and harness. `models`
present means use the saved list. An empty list means show no models from this connection. This
keeps an explicit user choice distinct from a record that predates model selection.

`harnesses` missing means use Agenta's technical compatibility. `harnesses` present means apply the
saved subset. The effective harnesses are always the intersection of the saved list and Agenta's
technical compatibility.

## Custom-provider record

Keep its current shape and add `harnesses` with the same meaning. Its existing `models` field remains
the connection-owned model list.

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
    models: Optional[list[Model]]
    allowed_harnesses: Optional[list[str]]
```

Credentials remain protected by the existing vault response and frontend redaction behavior. This
read model does not turn subscription detection into a stored connection.

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
