# Context

## Why this exists

The model vault (Settings -> "Providers & Models") only stores two shapes of secret
today: standard LLM provider keys (`OPENAI_API_KEY` and friends) and custom providers.
Users want to store other named secrets in the same vault, with any name they choose and a
single value, so the project has one place for its credentials.

The motivating downstream use is the agent workflows project: agents and their tools need
arbitrary credentials (a `GITHUB_TOKEN`, a `STRIPE_KEY`, an internal API token) that the
provider-key model cannot express. But that consumption path is explicitly out of scope
here. This iteration only adds the ability to store and manage these secrets.

## Goals

- Let a user create, edit, and delete a secret that is just a `name -> value` pair.
- Store it in the existing project vault, encrypted at rest like every other secret.
- Surface it in Settings as a third section next to standard and custom providers.

## Non-goals (this iteration)

- Do **not** inject these secrets into the agent runtime, sandbox, or any invocation.
  `services/oss/src/agent/secrets.py` and `get_user_llm_providers_secrets` stay untouched.
- No per-agent / per-revision scoping. These live in the project vault, same as provider
  keys.
- No new permission types. Reuse the existing `VIEW_SECRET` / `EDIT_SECRET` checks that
  already guard the vault router in EE.

## Key decisions

- **New `SecretKind = "custom_secret"`** rather than overloading `custom_provider`. Keeps
  validation, UI filtering, and any future runtime consumption unambiguous.
- **Reuse the generic vault stack.** The DAO, service, router, encryption (`PGPString`),
  and DTO<->DBE mappings are all `kind`-agnostic. The only backend code that changes is
  the enum, the DTO union + validator, and an Alembic enum migration.
- **Data shape mirrors the webhook secret**: `data = {secret: {key: "<value>"}}`, with the
  user-chosen name carried in `header.name`. This parallels `WebhookProviderDTO`
  (`provider.key`) so it sits naturally in the existing `Union`.
- **Frontend reuses `LlmProvider`** as the row model (`name`, `key`, `id`, `type`,
  `created_at`), so no new shared type is needed.
