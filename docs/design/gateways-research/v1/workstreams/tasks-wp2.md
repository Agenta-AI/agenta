# WP2 tasks — Secret resolution

Ordered so each item is one reviewable commit. Depends on the seed commit
(`core/gateways/policy/{dtos,types,interfaces}.py`) already existing on the base branch.
Depends on nothing else — WP2 can start immediately alongside WP1 and WP3, since it
consumes only `VaultService` (already landed) and a mock of it for tests.

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

- [x] `core/gateways/policy/resolution.py`: `SecretsResolver.__init__(self, *,
      vault_service: VaultService) -> None`, implementing `SecretsResolverInterface`.
- [x] `async def resolve(self, *, scope: AuthScope, ref: SecretRef, mode:
      SecretMode) -> ResolvedSecret`: dispatch on `type(ref)` /
      `isinstance(ref, ...)` to one private method per arm
      (`_resolve_provider_key`, `_resolve_bound_secret`). Every branch
      raises `SecretNotFoundError` or `SecretInvalidError` on failure — no bare
      `return None` anywhere in this file, and no branch that falls through without
      either returning a `ResolvedSecret` or raising.

## resolution.py — BoundSecretRef

- [x] Implement `_resolve_bound_secret`: call `vault_service.get_secret_by_id(ref.secret_id,
      project_id=scope.project_id)` positionally (not by keyword — confirm the real
      signature during Setup). `None` → `SecretNotFoundError(mode=mode,
      missing=SecretOwnerKind.PROJECT, target=f"secret:{ref.secret_id}")`. Otherwise
      wrap `ResolvedSecret(secret=..., owner=SecretOwner(kind=PROJECT),
      origin=SecretOrigin.VAULT)`.
- [x] Write the mode dispatch explicitly for this arm even though all three modes
      currently produce identical behavior (per specs-wp2.md's "mode table" section) —
      do not collapse into one code path with a comment saying "modes are equivalent for
      now."
- [x] No endpoint- or OAuth-specific branch needed: an OAuth MCP endpoint resolves
      through this same arm, called with `BoundSecretRef(secret_id=endpoint.secret_id)`
      at `mode=PROJECT_ONLY` by WP9 — this package does not need to know that.

## resolution.py — ProviderKeyRef

- [x] Implement `_resolve_provider_key`: `secrets = await
      vault_service.list_secrets(project_id=scope.project_id)`; match
      `kind == SecretKind.PROVIDER_KEY and secret.data.kind == ref.provider_key` first;
      if none, match `kind == SecretKind.CUSTOM_PROVIDER and secret.data.kind ==
      ref.provider_key`; if none, raise `SecretNotFoundError(mode=mode,
      missing=SecretOwnerKind.PROJECT, target=f"provider:{ref.provider_key}")`.
- [x] Same explicit-mode-dispatch note as the `BoundSecretRef` branch.
- [x] Same explicit `origin=SecretOrigin.VAULT` construction.

## resolution.py — available_provider_keys (R2, added at kickoff)

- [x] Implement `available_provider_keys(self, *, scope) -> Set[str]` over the
      same `list_secrets` scan `_resolve_provider_key` uses, returning the set
      of provider names found across `PROVIDER_KEY` and `CUSTOM_PROVIDER`.
- [x] Return names only — never a secret value, never a `ResolvedSecret`.
- [x] **Never raise for "none found."** The empty set is the correct answer; only
      `resolve()` raises, because a caller resolving has already committed to
      needing a secret. WP7 calls this to decide which generated endpoints
      exist (D20) and an empty project is an ordinary state, not an error.
- [x] Unit test: a project with an OpenAI `provider_key` and an Azure
      `custom_provider` returns exactly `{"openai", "azure"}`; a project with no
      secrets returns an empty set without raising.

## Ruff

- [x] Ruff format then ruff check `resolution.py`; fix all errors.
- [x] Commit: "core/gateways: implement SecretsResolver".

## tests — unit (run now)

- [x] `api/oss/tests/pytest/unit/gateways/test_gateways_resolution.py`: build a minimal
      mock `VaultService` (in-memory dict of `secret_id -> SecretResponseDTO`, a mock
      `list_secrets`/`get_secret_by_id` pair — do not subclass the real `VaultService`,
      implement only what `SecretsResolver` calls).
- [x] `BoundSecretRef`: secret exists → resolves with `owner.kind == PROJECT`.
- [x] `BoundSecretRef`: secret missing → `SecretNotFoundError(missing=PROJECT)`.
- [x] `BoundSecretRef` at each of the three `SecretMode` values, secret exists → resolves
      it with `owner.kind == PROJECT` in every case (no ref arm has a live per-user
      secret in this scope) — the test that catches a mode dispatch collapsed into one
      code path.
- [x] `ProviderKeyRef`: `provider_key`-kind match → resolves it.
- [x] `ProviderKeyRef`: no `provider_key`-kind match, `custom_provider`-kind match
      exists → resolves the `custom_provider` one.
- [x] `ProviderKeyRef`: both kinds match → resolves the `provider_key`-kind one.
- [x] `ProviderKeyRef`: no match → `SecretNotFoundError(missing=PROJECT)`.
- [x] Every raised `SecretNotFoundError`/`SecretInvalidError` across the above:
      assert `target` is non-empty and format-stable for a given input `ref`.
- [x] Ruff format + check; commit.

## routers.py diff (hand off at merge, do not commit directly)

- [x] Write the `SecretsResolver(vault_service=vault_service)` construction line from
      `specs-wp2.md` into this package's PR description for the IM1 merge.

## Definition of done

Feeds **IM1**, then **C1** through WP6 and WP8 (both call `resolve()` on the
relay path). Exit condition, verbatim from `plan.md`: *"each resolution mode behaves as
specified and no path silently returns no secret."*

WP2 is done when: every unit test above passes; grep over `resolution.py` confirms no
`return None` and no unreachable branch that neither returns a `ResolvedSecret` nor
raises; and the `USER_REQUIRED` no-fallback dispatch structure is visibly present (by
code inspection) on both ref arms, even though neither has a live per-user secret in this
scope.
