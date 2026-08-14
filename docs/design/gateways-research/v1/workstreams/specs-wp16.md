# WP16 — Secret kinds

**Owns:** the secret-kind enum, the per-kind settings DTOs, the union member list on the secret
DTO, and the kind validator's dispatch branch — wherever those four live (OSS, and EE if
mirrored).
**Depends on:** C2. **Blocks:** WP17.

D14 adds two secret kinds for OAuth. This package adds them to the existing kind machinery and
nothing else — no client, no storage adapter, no route. WP17 consumes what this package adds.

---

## The two kinds

**`oauth_provider`** — our client registration with an authorization server: client id, client
secret, issuer URL, scopes. The existing `sso_provider` kind is the precedent in both name and
shape. One per authorization server. Long-lived, rarely rotated, owned by the platform or the
project.

**`oauth_grant`** — a user's tokens: access token, refresh token, expiry, the scopes actually
granted, and the server the token was minted for. Identified by the upstream server rather than
by the provider, because tokens are audience-bound. One per owner per server. Rewritten on every
refresh, owned by a person.

**Two kinds, not sub-kinds of one (D14).** The sub-kind pattern in this codebase discriminates
the same thing across vendors — a provider key has one shape and one lifecycle whether it is
OpenAI or Anthropic. `oauth_provider` and `oauth_grant` share no fields and differ in
cardinality, lifetime, rotation frequency and owner. A single kind would need a union inside it,
and every query for a user's grants would filter on an inner field instead of on the kind.

## The four touch points

Per `secrets.md`, adding a kind touches four places and no schema, because the payload is one
encrypted blob:

1. **The kind enum** — append `oauth_provider` and `oauth_grant`.
2. **A settings DTO per kind, plus its wrapper** — `OAuthProviderSecretSettings` (client id,
   client secret, issuer URL, scopes) and `OAuthGrantSecretSettings` (access token, refresh
   token, expiry, granted scopes, server identifier).
3. **The union member list on the secret DTO** — add both wrapped settings types.
4. **The kind validator's branch** — the dispatcher is a hand-written
   `model_validator(mode="before")` keyed on the sibling `kind` field, not a Pydantic
   discriminated union. Each new kind needs its own branch or it is rejected outright.

## Coordinate, don't renumber

Parallel work is adding kinds to this same enum for sandbox providers and the tool gateway key.
**Append only.** Do not renumber, reorder or reformat existing members — a diff that touches an
existing line invites a merge conflict the other branch does not need.

## Contracts

- Never overload an existing kind. `custom_secret` and `custom_provider` exist for other things;
  reusing one to dodge adding a kind is a false economy (D14).
- No kind for a static MCP secret and no kind for the inbound gateway credential — both stay out
  of scope per `secrets.md`; this package does not add them.
- This package builds no client, no storage adapter, no CRUD route and no resolution logic. It
  makes the two kinds valid to construct and validate. WP17 is where they get used.
- If the SDK mirrors the kind enum, keep it in sync in the same commit; a drifted mirror fails
  silently the first time either side adds a kind the other does not know about.

## Tests

- Unit: `OAuthProviderSecretSettings` accepts a valid payload (client id, client secret, issuer
  URL, scopes) and rejects a payload missing a required field.
- Unit: `OAuthGrantSecretSettings` accepts a valid payload (access token, refresh token, expiry,
  granted scopes, server identifier) and rejects one missing a required field.
- Unit: the kind validator accepts `kind: "oauth_provider"` paired with `OAuthProviderSecretSettings`
  and rejects it paired with any other kind's settings, and the same for `oauth_grant`.
- Unit: the enum still contains every pre-existing member, unchanged and in the same order — a
  regression guard against the "append only" rule above.

## Out of scope

- The OAuth client itself, the storage adapter, connect callbacks (WP17).
- The consent flow and scope selection (WP18).
- Any resolution, ownership or resolution-mode logic (`secrets.md`'s Ownership and Resolution
  sections) — that work is designed but not scheduled, and this package does not schedule it.
- A static MCP secret kind — deferred per D14.
