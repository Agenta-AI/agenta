# Gateways: secrets

Secret kinds, ownership, and resolution. Supersedes the scoping draft in `raw/`; this is the
version the implementation follows.

**Status: the storage pattern and the kinds are settled. Ownership is designed, not
scheduled.**

## Vocabulary

The tree already fixes these words, and this document follows it:

- A customer's provider key is a **secret**.
- **Credentials** means Agenta's own auth — API keys, secret tokens, access tokens.
- **`secret_origin`** is `vault` when the secret is the customer's and `local` when it is the
  platform's.

Other documents here still say "credential" for upstream provider material. That is the older
wording and it should move to this one. `raw/related-work.md` records why.

`secret_origin` answers a different question from the owner axis below. The owner says *which
stored secret to look up*; the origin says *whose money the call spends*. Parallel work on
bring-your-own secrets already uses the origin to zero-rate customer-funded usage.

**The read surface is an outcome, not a gate.** The secrets read route returns plaintext to any
caller holding the view permission, and the agent path resolves straight through it. That cannot
be fixed first: callers read it today because it is how they obtain a provider key at all. Once
everything goes through the gateway, nothing needs that route, and only then can it be
restricted. See `notes.md`.

## The storage pattern: reference, never hold

The gateways store **no secret material**. A domain row carries a `secret_id`, the
secrets service holds the encrypted value, and the consumer resolves it at use time through
the vault service, reading the value off the returned DTO. Domain responses exclude the
secret and its id.

Webhook subscriptions and SSO providers already work exactly this way. Following it settles
several things that would otherwise be design work:

- **Encryption** — the secrets layer already encrypts at rest; the gateways inherit it.
- **Key management** — unchanged, and not duplicated.
- **Rotation and deletion** — one place, not one per consumer.
- **Scoping** — a property of the secrets service, which is why the ownership work below is a
  change to *that* service rather than to either gateway.

## New secret kinds

Existing kinds are `provider_key`, `custom_provider`, `sso_provider`, `webhook_provider` and
`custom_secret`. Adding one touches four places and **no schema at all**, because the payload is
one encrypted blob: the kind enum, a settings DTO plus its wrapper, the union member list on the
secret DTO, and a branch in the kind validator.

That validator is a hand-written `model_validator(mode="before")` dispatching on the sibling
`kind` field, not a Pydantic discriminated union — so a new kind must add its own branch or it
is rejected outright.

**Never overload an existing kind.** The general-purpose custom secret and custom provider
kinds exist for other things, and reusing one to avoid adding a kind is a false economy.

Two new kinds, per D14.

### `oauth_provider`

Our client registration with an authorization server. The SSO kind is the precedent in both
name and shape — it already stores a client id, a client secret, an issuer URL and scopes,
which is exactly this.

One per authorization server. Long-lived, rarely rotated, owned by the platform or the project.

### `oauth_grant`

A user's tokens: access token, refresh token, expiry, the scopes actually granted, and the
server the token was minted for. Tokens are audience-bound, so a grant is identified by the
upstream server rather than by the provider.

One per owner per server. Rewritten on every refresh, owned by a person.

### Why two kinds rather than one with sub-kinds

The sub-kind pattern here discriminates the *same thing across vendors* — a provider key has
one shape and one lifecycle whether it is OpenAI or Anthropic, and the inner field only names
the vendor.

These two share no fields, and differ in cardinality, lifetime, rotation frequency and owner. A
single kind would need a union inside it anyway, and every query for one user's grants would
filter on an inner field instead of on the kind itself.

### What is deliberately absent

**No kind for a static MCP credential.** Under the current scope (D15) the targets are Agenta's
own MCP gateway and OAuth-protected servers. A third-party server authenticating with a static
token would need one; that is deferred, not designed away. Its shape is trivial when it arrives
— the webhook kind is already just a key — and the header it travels in is routing, so that
belongs on the server's registry row rather than in the vault.

**No kind for the inbound gateway credential.** It is minted, ephemeral and never stored
(D13). It is Agenta's own auth, not customer provider material, so it is not a secret at all.

### Coordination

The parallel bring-your-own-secrets work is adding kinds to this same enum for sandbox
providers and the tool gateway key. Several new kinds are entering one enum from two
directions; agree naming and shapes in one pass.

## Ownership

**Designed, not scheduled.** Today every secret and every connection is project-scoped, so
every credential is effectively shared.

A secret is owned by exactly one of:

- **project** — what exists today; everyone in the project uses it.
- **user** — one member's own credential, keyed by **(project, user)** rather than user
  alone, because the same person may legitimately use different credentials in different
  projects, and a deleted project should take its secrets with it.

An account-wide credential — one identity across every project — would be a third owner keyed
by (organization, user), not a variant of the second. Out of scope until something needs it.

### Why design it before building it

The lookup signature is the expensive part to change later. A lookup that takes an owner and
currently always answers "the project" costs nothing today and absorbs user-level credentials
as a storage change. A lookup that assumes the project spreads that assumption to every call
site.

The caller side needs nothing either way: the principal already carries the user on every
request.

## Resolution modes

Resolution is not simply "user wins." Three modes, declared per entry, because the
organization sometimes has a legitimate interest in which credential is used:

| Mode | Behaviour | For |
|---|---|---|
| `user_optional` | the user's if present, else the project's | the default |
| `user_required` | the user's, or fail — never fall back | upstreams holding personal data |
| `project_only` | always the project's; ignore user secrets | mandated credentials, spend control |

The two non-default modes earn the design. `user_required` stops an agent quietly acting as
someone else's account when it reaches a personal mailbox. `project_only` stops a user's own
key being used where the organization pays and wants one billing identity.

This produces a deliberate asymmetry: **model credentials will usually be `project_only`;
tool and MCP credentials usually `user_optional` or `user_required`.**

## Resolution

One function, called by both planes:

```text
resolve(principal, key, mode) -> (credential, owner, payer)
```

1. `project_only` → the project secret; fail if absent.
2. `user_required` → the (project, user) secret; fail if absent, never fall back.
3. `user_optional` → the (project, user) secret if present, else the project secret; fail if
   neither.

Failure is never silent and never a fallback to "no credential." It surfaces as the existing
needs-input or needs-auth state, naming which owner is missing a credential, so the caller
learns whether *they* must connect or whether an administrator must.

### Why the result is a triple

Two values must travel with the credential, and both are easy to omit and hard to add later:

- **owner** — audit must distinguish "acted with the project's credential" from "acted with
  their own," or a compliance review cannot reconstruct whose authority a call carried.
- **payer** — a call running on a user's own credential bills that user's upstream account,
  not the organization's. A meter recording only the caller attributes spend to the wrong
  payer, and the data needed to correct it is not retained.

## Effect on existing data

Existing secrets and connections all become owner = project, which is what they already are.
A default column value, not a data migration.

## Open

- The product default: is `user_optional` the norm and `project_only` the exception, or the
  reverse? This decides how much existing configuration is revisited when user credentials
  ship.
- Whether an administrator sets the mode per upstream, or whether it is a property of the
  upstream itself.
- Whether a user-owned credential is visible to project administrators at all, and what that
  implies for support and for deletion when a member leaves.
