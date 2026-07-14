# Context

## Why this exists

An Agenta agent run needs two things: a model, and a credential authorized to call that model.
Agenta picks the model loosely and injects the credential bluntly. This project fixes both, for
the agent (harness) path.

## Current state

- The agent config carries one bare string, `AgentConfig.model`
  (`sdks/python/agenta/sdk/agents/dtos.py:324`; `HarnessAgentConfig.model:419`). There is no
  provider, no base URL, no notion of which credential to use.
- At run time the service calls `resolve_provider_keys`
  (`sdks/python/agenta/sdk/agents/platform/secrets.py:105-141`), fetches the whole project vault
  over `GET /secrets/`, and sets every recognized provider key as a harness env var. The chosen
  model never participates. The function skips `custom_provider` secrets entirely (`:134`), so no
  base URL ever reaches a harness, and `setdefault` (`:140`) keeps the first key per provider, so a
  second key for the same provider is silently dropped. The `_PROVIDER_ENV_VARS` map (`:93-102`) is
  incomplete and maps `together_ai` to the wrong env var.
- The secret vault stores two relevant kinds (`api/oss/src/core/secrets/dtos.py`): `provider_key`
  (`StandardProviderDTO`, just a key, `:17-23`) and `custom_provider` (`CustomProviderDTO`, with
  `url`/`version`/`key`/`extras`, a `models[]` list, and a `provider_slug` taken from the secret's
  name, `:38-45`, `:225-230`). The DB constrains only `id`, so two keys for one provider already
  coexist; the agent path just refuses to use the second. The secret name (`Header.name`) is today
  nullable, mutable, and not unique (`api/oss/src/dbs/postgres/secrets/mappings.py`).
- The prompt/completion path resolves separately, in the SDK, into LiteLLM kwargs:
  `SecretsManager.get_provider_settings` (`sdks/python/agenta/sdk/managers/secrets.py:158`) maps a
  model to a provider to a stored key, rewrites custom providers to look OpenAI-compatible
  (`:147-150`), and on duplicate keys the last one wins (`:219`).
- OAuth subscription logins (a ChatGPT, Claude, or Gemini plan) are handled ad hoc. The three
  harnesses all rewrite their OAuth credential file at run time when the token rotates
  (see [research.md](research.md), Part 2.3), so a frozen copy stored in the vault goes stale.

## Goals

1. Select a **provider and a model** in a harness-neutral way that maps cleanly to Pi, Claude
   Code, and Codex.
2. Inject **only the credential the selected model needs**, not the whole vault.
3. Support **multiple credentials per provider** (a prod and a dev OpenAI key) and let the config
   pick which one by name.
4. Support **custom providers and base URLs** (Azure, Bedrock, Vertex, an OpenAI-compatible
   gateway) for harnesses that can reach them, reusing the `custom_provider` secrets the vault
   already stores.
5. Handle **OAuth subscriptions** by running them self-managed: the harness uses its own rotating
   login and Agenta injects nothing.
6. Let an **SDK user bring their own credential** at instantiation, or use Agenta's vault. Same
   port, different adapter.
7. Tell the **frontend which providers and connection modes each harness supports**, so the form
   shows only what the selected harness can use.
8. Keep the playground change **minimal**: a form that exposes the variables directly, plus a
   raw-JSON escape hatch.

## Non-goals (for v1)

- A new credential storage model, write path, or CRUD. v1 reads the existing vault.
- A storage migration or any change to the vault encryption column or the `/secrets` API.
- Migrating the prompt/completion path onto the new resolution. Completions keep their current
   code.
- Durable storage of rotating OAuth access tokens. OAuth subscriptions run self-managed.
- The capability-table mechanism itself. This project adds entries to the table the
  [../harness-capabilities/](../harness-capabilities/) project owns.
- Fixing the weak `AGENTA_CRYPT_KEY` default (`"replace-me"`, `api/oss/src/utils/env.py:410`).
  Flagged, tracked as a follow-up.

## Constraints inherited from the codebase

- The SDK owns neutral ports and data contracts; the service plugs in Agenta adapters; the SDK
  must not import the service (`../ports-and-adapters.md`).
- New API code follows the domain folder shape in `api/CLAUDE.md`
  (`apis/fastapi/<domain>`, `core/<domain>`, `dbs/postgres/<domain>`), with typed DTO returns and
  domain exceptions.
- The `/run` wire contract is duplicated in Python (`sdks/python/agenta/sdk/agents/utils/wire.py`)
  and TypeScript (`services/agent/src/protocol.ts`) and pinned by golden tests. Any wire change
  updates both sides and the tests in one PR.
- The agent invoke handler receives the config inside `parameters`
  (`services/oss/src/agent/app.py`, `_agent(...)`), built by `AgentConfig.from_params`. The
  connection rides the config that the request already carries; no new request field is needed.
