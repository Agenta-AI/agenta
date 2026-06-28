# Context

## Why this exists

The model vault (Settings -> "Providers & Models") only stores two shapes of secret
today: standard LLM provider keys (`OPENAI_API_KEY` and friends) and custom providers.
Users want to store other named secrets in the same vault, with any name they choose, so
the project has one place for its credentials.

Each named secret declares a **format** that governs what its value may contain and how it
is interpreted (the AWS Secrets Manager model — a secret is either an opaque blob or a flat
key/value map):

- **`text`** — an opaque string. Stored verbatim, no structural validation. A JSON string
  handed to a `text` secret is stored as-is (we do **not** silently re-serialize it). Loaded
  downstream as a single value / file body.
- **`json`** — a **flat, single-level** object: every value is a JSON primitive (string,
  number, boolean, null). **No nested objects, no arrays.** This is the shape that maps
  cleanly onto environment variables. The backend **rejects** nesting or arrays.

Whether a `json` secret is rendered as a JSON editor or a key/value grid, and whether a
`text` blob is shown raw / prettified / wrapped, are purely **UI choices**. The stored value
is identical regardless of presentation; `format` is the only thing that changes validation.

The motivating downstream use is the agent workflows project: agents and their tools need
arbitrary credentials (a `GITHUB_TOKEN`, a `STRIPE_KEY`, an internal API token) that the
provider-key model cannot express. But that consumption path is explicitly out of scope
here. This iteration only adds the ability to store and manage these secrets.

## Goals

- Let a user create, edit, and delete a named secret whose value is either a `text` blob or
  a flat `json` object (see formats above).
- Store it in the existing project vault, encrypted at rest like every other secret.
- Surface it in Settings under its own **Vault** section — **not** under "Providers &
  Models". That section is LLM-scoped (and should arguably be renamed "LLMs", since tools,
  triggers, etc. now live elsewhere) and also contains internal secrets users never manage
  directly (webhook, SSO). User-defined secrets get their own home.

## Non-goals (this iteration)

- Do **not** inject these secrets into the agent runtime, sandbox, or any invocation.
  `services/oss/src/agent/secrets.py` and `get_user_llm_providers_secrets` stay untouched.
- No per-agent / per-revision scoping. These live in the project vault, same as provider
  keys.
- No new permission types. Reuse the existing `VIEW_SECRET` / `EDIT_SECRET` checks that
  already guard the vault router in EE.

## Key decisions

- **One new `SecretKind = "custom_secret"`** rather than overloading `custom_provider`.
  Keeps validation, UI filtering, and any future runtime consumption unambiguous.
- **`format` lives in the secret data, not in the kind.** A single `custom_secret` kind
  carries a `format: "text" | "json"` discriminator. One kind, validation branches on
  `format`. (We deliberately did **not** split into `custom_secret_text` /
  `custom_secret_json` — that would double the enum, the migration, and the UI filtering for
  what is one concept with two validation rules.)
- **Reuse the generic vault stack.** The DAO, service, router, encryption (`PGPString`),
  and DTO<->DBE mappings are all `kind`-agnostic. The only backend code that changes is
  the enum, the DTO union + validator, and an Alembic enum migration.
- **Data shape**: `data = {secret: {format: "text"|"json", value: <string|object>}}`, with
  the user-chosen name carried in `header.name`. `text` → `value` is a string; `json` →
  `value` is a flat object of primitives. This sits naturally in the existing untagged
  `Union` (`{secret: {...}}` is distinct from the provider shapes `{provider: {...}}`).
- **Frontend reuses `LlmProvider`** only where the row is a simple name/value pair; the
  named-secret table carries `name`, `format`, the (masked) value, `id`, and `created_at`.
