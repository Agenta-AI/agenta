# WP16 — tasks

Read [`specs-wp16.md`](specs-wp16.md) first. Branch from `feat/gateways` (C3's predecessor).

## Phase 0 — locate the machinery

- [ ] Find the kind enum, the settings DTOs (using `sso_provider`'s as the shape precedent), the
      union member list, and the validator's dispatch branch. Confirm whether EE mirrors any of
      it or imports from OSS, and whether the SDK mirrors the enum.
- [ ] Note the enum's current tail so the new members append cleanly. Do not touch existing
      members' order or formatting.

## Phase 1 — the two kinds

- [ ] Append `oauth_provider` and `oauth_grant` to the kind enum, after the existing members.
- [ ] Add `OAuthProviderSecretSettings` (client id, client secret, issuer URL, scopes) and its
      wrapper, following the `sso_provider` settings DTO's shape exactly.
- [ ] Add `OAuthGrantSecretSettings` (access token, refresh token, expiry, granted scopes, server
      identifier) and its wrapper.
- [ ] Add both wrapped settings types to the union member list on the secret DTO.
- [ ] Add the two dispatch branches to the kind validator's `model_validator(mode="before")`.
- [ ] If EE mirrors this machinery rather than importing it, apply the same four edits there.
- [ ] If the SDK mirrors the kind enum, append the same two members there in the same commit.

## Phase 2 — tests

- [ ] Unit: each new settings DTO accepts a valid payload and rejects one missing a required
      field.
- [ ] Unit: the kind validator accepts each new kind paired with its own settings type and
      rejects it paired with a mismatched settings type.
- [ ] Unit: a regression guard asserting every pre-existing enum member is still present,
      unchanged, in its original order.
- [ ] `ruff format` && `ruff check --fix` in `api/`; run the API unit tests.
- [ ] Commit: "gateways(secrets): add oauth_provider and oauth_grant kinds".

## Definition of done

- `oauth_provider` and `oauth_grant` exist in the kind enum, appended after the existing
  members, with no reordering.
- Both kinds have a settings DTO, a union arm, and a validator branch, following the
  `sso_provider` precedent.
- No client, storage adapter, route or resolution logic was added — that is WP17 and later.
- Existing enum members are untouched; the new work merges cleanly alongside the parallel
  kind-adding branch.
