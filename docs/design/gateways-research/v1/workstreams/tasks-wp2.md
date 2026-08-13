# WP2 tasks — Secret resolution

Ordered so each item is one reviewable commit. Depends on the seed commit
(`core/gateways/policy/{dtos,types,interfaces}.py`) already existing on the base branch.
Depends on nothing else — WP2 can start immediately alongside WP1 and WP3, since it
consumes `McpGrantsDAOInterface` (seed-declared) rather than WP1's concrete
implementation, and a fake of it for tests.

## Setup

- [x] Read `sdks/python/agenta/sdk/agents/platform/connections.py` in full, focusing on
      `_provider_key_candidate`, `_custom_provider_candidate`, and `_catalog` — this is
      the precedent `ProviderKeyRef` resolution must match, not re-derive.
- [x] Read `core/secrets/services.py` (`VaultService`) and `core/secrets/context.py`
      (`set_data_encryption_key`) in full — confirm whether `VaultService`'s own methods
      already open the encryption context internally (they do, as of this spec being
      written; re-verify, since a change there would change whether `resolution.py` needs
      to wrap its own calls).

## resolution.py — skeleton

- [x] `core/gateways/policy/resolution.py`: `CredentialResolver.__init__(self, *,
      vault_service: VaultService, mcp_grants_dao: McpGrantsDAOInterface) -> None`,
      implementing `CredentialResolverInterface`.
- [x] `async def resolve(self, *, scope: AuthScope, ref: CredentialRef, mode:
      CredentialMode) -> ResolvedCredential`: dispatch on `type(ref)` /
      `isinstance(ref, ...)` to one private method per arm
      (`_resolve_provider_key`, `_resolve_bound_secret`, `_resolve_grant`). Every branch
      raises `CredentialNotFoundError` or `CredentialInvalidError` on failure — no bare
      `return None` anywhere in this file, and no branch that falls through without
      either returning a `ResolvedCredential` or raising.

## resolution.py — BoundSecretRef

- [x] Implement `_resolve_bound_secret`: call `vault_service.get_secret_by_id(ref.secret_id,
      project_id=scope.project_id)` positionally (not by keyword — confirm the real
      signature during Setup). `None` → `CredentialNotFoundError(mode=mode,
      missing=CredentialOwnerKind.PROJECT, target=f"secret:{ref.secret_id}")`. Otherwise
      wrap `ResolvedCredential(secret=..., owner=CredentialOwner(kind=PROJECT),
      origin=SecretOrigin.VAULT)`.
- [x] Write the mode dispatch explicitly for this arm even though all three modes
      currently produce identical behavior (per specs-wp2.md's "mode table" section) —
      do not collapse into one code path with a comment saying "modes are equivalent for
      now."

## resolution.py — ProviderKeyRef

- [x] Implement `_resolve_provider_key`: `secrets = await
      vault_service.list_secrets(project_id=scope.project_id)`; match
      `kind == SecretKind.PROVIDER_KEY and secret.data.kind == ref.provider_key` first;
      if none, match `kind == SecretKind.CUSTOM_PROVIDER and secret.data.kind ==
      ref.provider_key`; if none, raise `CredentialNotFoundError(mode=mode,
      missing=CredentialOwnerKind.PROJECT, target=f"provider:{ref.provider_key}")`.
- [x] Same explicit-mode-dispatch note as the `BoundSecretRef` branch.
- [x] Same explicit `origin=SecretOrigin.VAULT` construction.

## resolution.py — available_provider_keys (R2, added at kickoff)

- [x] Implement `available_provider_keys(self, *, scope) -> Set[str]` over the
      same `list_secrets` scan `_resolve_provider_key` uses, returning the set
      of provider names found across `PROVIDER_KEY` and `CUSTOM_PROVIDER`.
- [x] Return names only — never a secret value, never a `ResolvedCredential`.
- [x] **Never raise for "none found."** The empty set is the correct answer; only
      `resolve()` raises, because a caller resolving has already committed to
      needing a credential. WP7 calls this to decide which generated endpoints
      exist (D20) and an empty project is an ordinary state, not an error.
- [x] Unit test: a project with an OpenAI `provider_key` and an Azure
      `custom_provider` returns exactly `{"openai", "azure"}`; a project with no
      secrets returns an empty set without raising.

## resolution.py — GrantRef

- [x] Implement `_resolve_grant`, writing out the full three-way `mode` table from
      `specs-wp2.md` rather than an abbreviated chain:
      - `PROJECT_ONLY`: `mcp_grants_dao.fetch_grant(project_id=scope.project_id,
        endpoint_id=ref.endpoint_id, user_id=None)` only. Miss →
        `CredentialNotFoundError(mode=PROJECT_ONLY, missing=PROJECT, target=...)`.
      - `USER_REQUIRED`: `fetch_grant(..., user_id=scope.user_id)` only, **never**
        followed by a `user_id=None` lookup. Miss → `CredentialNotFoundError(mode=
        USER_REQUIRED, missing=USER, target=...)`.
      - `USER_OPTIONAL`: `fetch_grant(..., user_id=scope.user_id)` first; if `None`,
        `fetch_grant(..., user_id=None)`. Both miss → `CredentialNotFoundError(mode=
        USER_OPTIONAL, missing=USER, target=...)` — `missing` is `USER` (the narrower
        owner) even though the project lookup was also attempted.
- [x] Once a grant row is found (any mode): if `not grant.flags.is_valid`, raise
      `CredentialInvalidError(target=f"endpoint:{ref.endpoint_id}")` **before** touching
      the vault — do not call `vault_service.get_secret_by_id` for an invalid grant.
- [x] Otherwise call `vault_service.get_secret_by_id(grant.secret_id,
      project_id=scope.project_id)`; `None` (dangling FK defensive case) →
      `CredentialInvalidError(target=..., detail="secret missing")` — **not**
      `CredentialNotFoundError`, since a grant row genuinely exists.
- [x] Build `owner=CredentialOwner(kind=USER, user_id=grant.user_id)` when the resolved
      grant's `user_id` is set, `CredentialOwner(kind=PROJECT)` when it is `None` — the
      owner reflects **which grant row answered**, not `scope.user_id` directly (in
      `USER_OPTIONAL`'s fallback case these differ: the caller is `scope.user_id`, the
      credential's owner is the project).

## Ruff

- [x] Ruff format then ruff check `resolution.py`; fix all errors.
- [x] Commit: "core/gateways: implement CredentialResolver".

## tests — unit (run now)

- [x] `api/oss/tests/pytest/unit/gateways/test_gateways_resolution.py`: build a minimal
      fake `VaultService` (in-memory dict of `secret_id -> SecretResponseDTO`, a fake
      `list_secrets`/`get_secret_by_id` pair — do not subclass the real `VaultService`,
      implement only what `CredentialResolver` calls) and a fake
      `McpGrantsDAOInterface` (in-memory dict keyed on `(endpoint_id, user_id)`).
- [x] `BoundSecretRef`: secret exists → resolves with `owner.kind == PROJECT`.
- [x] `BoundSecretRef`: secret missing → `CredentialNotFoundError(missing=PROJECT)`.
- [x] `ProviderKeyRef`: `provider_key`-kind match → resolves it.
- [x] `ProviderKeyRef`: no `provider_key`-kind match, `custom_provider`-kind match
      exists → resolves the `custom_provider` one.
- [x] `ProviderKeyRef`: both kinds match → resolves the `provider_key`-kind one.
- [x] `ProviderKeyRef`: no match → `CredentialNotFoundError(missing=PROJECT)`.
- [x] `GrantRef`, `PROJECT_ONLY`, only a user-owned grant exists → `CredentialNotFoundError`
      (must NOT fall through to the user's grant — this is the test most likely to catch
      a `PROJECT_ONLY` that accidentally behaves like `USER_OPTIONAL`).
- [x] `GrantRef`, `USER_REQUIRED`, only a project-owned grant exists → `CredentialNotFoundError(missing=USER)`
      (must NOT fall back to the project's — the single most important assertion in this
      package).
- [x] `GrantRef`, `USER_REQUIRED`, a user-owned grant exists → resolves it,
      `owner.kind == USER`, `owner.user_id == scope.user_id`.
- [x] `GrantRef`, `USER_OPTIONAL`, both a user grant and a project grant exist →
      resolves the user's.
- [x] `GrantRef`, `USER_OPTIONAL`, only a project grant exists → resolves it,
      `owner.kind == PROJECT`.
- [x] `GrantRef`, `USER_OPTIONAL`, neither exists → `CredentialNotFoundError(missing=USER)`.
- [x] `GrantRef`, grant exists with `is_valid=False` → `CredentialInvalidError`,
      regardless of mode; assert the fake vault's `get_secret_by_id` was never called.
- [x] `GrantRef`, grant exists and valid, `secret_id` resolves to nothing in the fake
      vault → `CredentialInvalidError` (not `CredentialNotFoundError`).
- [x] Every raised `CredentialNotFoundError`/`CredentialInvalidError` across the above:
      assert `target` is non-empty and format-stable for a given input `ref`.
- [x] Ruff format + check; commit.

## routers.py diff (hand off at merge, do not commit directly)

- [x] Write the `CredentialResolver(vault_service=vault_service,
      mcp_grants_dao=mcp_grants_dao)` construction line from `specs-wp2.md` into this
      package's PR description for the M1 merge — ordered after WP1's `mcp_grants_dao`
      construction line.

## Definition of done

Feeds **M1**, then **Checkpoint A** through WP6 and WP8 (both call `resolve()` on the
relay path). Exit condition, verbatim from `plan.md`: *"each resolution mode behaves as
specified and no path silently returns no secret."*

WP2 is done when: every unit test above passes; grep over `resolution.py` confirms no
`return None` and no unreachable branch that neither returns a `ResolvedCredential` nor
raises; and the `USER_REQUIRED` no-fallback assertion passes for `GrantRef` (real
behavior today) with the same dispatch structure visibly present (by code inspection) on
the other two ref arms.
