"""Unit tests for `CredentialResolver` (specs-wp2.md, tasks-wp2.md).

Every case below runs against a dict-backed fake `VaultService` and a dict-backed fake
`McpGrantsDAOInterface` — no Postgres, no Redis, no encryption key. The mode-table cases
(`USER_REQUIRED` never falls back, `USER_OPTIONAL` names the narrower owner) are the point
of this suite; everything else exists to pin the ref-arm matching rules.
"""

from typing import Dict, List, Optional, Tuple
from uuid import UUID, uuid4

import pytest

from oss.src.core.gateways.mcps.dtos import McpGrant, McpGrantFlags
from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    CredentialMode,
    CredentialOwnerKind,
    GrantRef,
    ProviderKeyRef,
    SecretOrigin,
)
from oss.src.core.gateways.policy.resolution import CredentialResolver
from oss.src.core.gateways.policy.types import (
    CredentialInvalidError,
    CredentialNotFoundError,
)
from oss.src.core.secrets.dtos import (
    CustomProviderDTO,
    CustomProviderSettingsDTO,
    CustomSecretDTO,
    CustomSecretSettingsDTO,
    SecretResponseDTO,
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import (
    CustomProviderKind,
    CustomSecretFormat,
    SecretKind,
    StandardProviderKind,
)
from oss.src.core.shared.dtos import Header
from oss.src.utils.context import AuthScope

ALL_MODES = [
    CredentialMode.PROJECT_ONLY,
    CredentialMode.USER_REQUIRED,
    CredentialMode.USER_OPTIONAL,
]


# --- fakes (WP2 must not subclass the real VaultService / DAO) ---------------- #


class FakeVaultService:
    """In-memory secret_id -> SecretResponseDTO map; implements only the two
    VaultService methods CredentialResolver calls."""

    def __init__(self, secrets: Optional[List[SecretResponseDTO]] = None) -> None:
        self._by_id: Dict[UUID, SecretResponseDTO] = {s.id: s for s in secrets or []}
        self.get_secret_by_id_calls = 0

    async def list_secrets(self, project_id=None, organization_id=None):
        return list(self._by_id.values())

    async def get_secret_by_id(self, secret_id, project_id=None, organization_id=None):
        self.get_secret_by_id_calls += 1
        return self._by_id.get(secret_id)


class FakeMcpGrantsDAO:
    """In-memory (endpoint_id, user_id) -> McpGrant map."""

    def __init__(self, grants: Optional[List[McpGrant]] = None) -> None:
        self._by_key: Dict[Tuple[UUID, Optional[UUID]], McpGrant] = {
            (grant.endpoint_id, grant.user_id): grant for grant in grants or []
        }

    async def fetch_grant(self, *, project_id, endpoint_id, user_id):
        return self._by_key.get((endpoint_id, user_id))


# --- fixtures ------------------------------------------------------------------ #


def _scope(*, user_id: Optional[UUID] = None) -> AuthScope:
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=user_id or uuid4(),
    )


def _bound_secret() -> SecretResponseDTO:
    return SecretResponseDTO(
        id=uuid4(),
        kind=SecretKind.CUSTOM_SECRET,
        data=CustomSecretDTO(
            secret=CustomSecretSettingsDTO(
                format=CustomSecretFormat.TEXT, content="bound-secret-value"
            )
        ),
        header=Header(name="bound"),
    )


def _provider_key_secret(
    provider: StandardProviderKind, *, key: str = "sk-test"
) -> SecretResponseDTO:
    return SecretResponseDTO(
        id=uuid4(),
        kind=SecretKind.PROVIDER_KEY,
        data=StandardProviderDTO(
            kind=provider, provider=StandardProviderSettingsDTO(key=key)
        ),
        header=Header(name=provider.value),
    )


def _custom_provider_secret(
    provider: CustomProviderKind, *, key: str = "ck-test"
) -> SecretResponseDTO:
    # SecretResponseDTO's own before-validator (build_up_model_keys) special-cases
    # CUSTOM_PROVIDER and expects a dict, unlike SecretDTO's — pass a dict, not the
    # model instance, so it doesn't see a CustomProviderDTO where it calls .get(...).
    data = CustomProviderDTO(
        kind=provider,
        provider=CustomProviderSettingsDTO(key=key),
        models=[],
    ).model_dump()
    return SecretResponseDTO(
        id=uuid4(),
        kind=SecretKind.CUSTOM_PROVIDER,
        data=data,
        header=Header(name=provider.value),
    )


def _grant(
    *, endpoint_id: UUID, user_id: Optional[UUID] = None, is_valid: bool = True
) -> McpGrant:
    return McpGrant(
        id=uuid4(),
        endpoint_id=endpoint_id,
        user_id=user_id,
        secret_id=uuid4(),
        flags=McpGrantFlags(is_valid=is_valid),
    )


def _resolver(
    *, secrets=None, grants=None
) -> Tuple[CredentialResolver, FakeVaultService, FakeMcpGrantsDAO]:
    vault = FakeVaultService(secrets)
    dao = FakeMcpGrantsDAO(grants)
    resolver = CredentialResolver(vault_service=vault, mcp_grants_dao=dao)
    return resolver, vault, dao


# --- BoundSecretRef -------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_bound_secret_resolves_when_present():
    secret = SecretResponseDTO(
        id=uuid4(),
        kind=SecretKind.PROVIDER_KEY,
        data=StandardProviderDTO(
            kind=StandardProviderKind.OPENAI,
            provider=StandardProviderSettingsDTO(key="sk-test"),
        ),
        header=Header(name="openai"),
    )
    resolver, _vault, _dao = _resolver(secrets=[secret])
    scope = _scope()

    resolved = await resolver.resolve(
        scope=scope,
        ref=BoundSecretRef(secret_id=secret.id),
        mode=CredentialMode.PROJECT_ONLY,
    )

    assert resolved.secret.id == secret.id
    assert resolved.owner.kind == CredentialOwnerKind.PROJECT
    assert resolved.origin == SecretOrigin.VAULT


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ALL_MODES)
async def test_bound_secret_missing_raises_for_every_mode(mode):
    resolver, _vault, _dao = _resolver()
    scope = _scope()
    missing_id = uuid4()

    with pytest.raises(CredentialNotFoundError) as excinfo:
        await resolver.resolve(
            scope=scope, ref=BoundSecretRef(secret_id=missing_id), mode=mode
        )

    assert excinfo.value.missing == CredentialOwnerKind.PROJECT
    assert excinfo.value.mode == mode
    assert excinfo.value.target == f"secret:{missing_id}"


# --- ProviderKeyRef --------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_provider_key_match_resolves():
    secret = _provider_key_secret(StandardProviderKind.OPENAI)
    resolver, _vault, _dao = _resolver(secrets=[secret])

    resolved = await resolver.resolve(
        scope=_scope(),
        ref=ProviderKeyRef(provider_key="openai"),
        mode=CredentialMode.PROJECT_ONLY,
    )

    assert resolved.secret.id == secret.id
    assert resolved.owner.kind == CredentialOwnerKind.PROJECT
    assert resolved.origin == SecretOrigin.VAULT


@pytest.mark.asyncio
async def test_provider_key_falls_back_to_custom_provider_when_no_provider_key_match():
    custom = _custom_provider_secret(CustomProviderKind.AZURE)
    resolver, _vault, _dao = _resolver(secrets=[custom])

    resolved = await resolver.resolve(
        scope=_scope(),
        ref=ProviderKeyRef(provider_key="azure"),
        mode=CredentialMode.PROJECT_ONLY,
    )

    assert resolved.secret.id == custom.id


@pytest.mark.asyncio
async def test_provider_key_prefers_provider_key_kind_over_custom_provider():
    standard = _provider_key_secret(StandardProviderKind.OPENAI)
    # Matches the same provider name via the CustomProviderKind arm too.
    custom = _custom_provider_secret(CustomProviderKind.OPENAI)
    resolver, _vault, _dao = _resolver(secrets=[custom, standard])

    resolved = await resolver.resolve(
        scope=_scope(),
        ref=ProviderKeyRef(provider_key="openai"),
        mode=CredentialMode.PROJECT_ONLY,
    )

    assert resolved.secret.id == standard.id
    assert resolved.secret.kind == SecretKind.PROVIDER_KEY


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ALL_MODES)
async def test_provider_key_no_match_raises_for_every_mode(mode):
    resolver, _vault, _dao = _resolver()

    with pytest.raises(CredentialNotFoundError) as excinfo:
        await resolver.resolve(
            scope=_scope(), ref=ProviderKeyRef(provider_key="openai"), mode=mode
        )

    assert excinfo.value.missing == CredentialOwnerKind.PROJECT
    assert excinfo.value.target == "provider:openai"


# --- available_provider_keys (R2) ------------------------------------------------- #


@pytest.mark.asyncio
async def test_available_provider_keys_returns_names_across_both_kinds():
    resolver, _vault, _dao = _resolver(
        secrets=[
            _provider_key_secret(StandardProviderKind.OPENAI),
            _custom_provider_secret(CustomProviderKind.AZURE),
        ]
    )

    keys = await resolver.available_provider_keys(scope=_scope())

    assert keys == {"openai", "azure"}


@pytest.mark.asyncio
async def test_available_provider_keys_empty_project_returns_empty_set_without_raising():
    resolver, _vault, _dao = _resolver()

    keys = await resolver.available_provider_keys(scope=_scope())

    assert keys == set()


# --- GrantRef ----------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_grant_project_only_resolves_project_grant():
    endpoint_id = uuid4()
    grant = _grant(endpoint_id=endpoint_id, user_id=None)
    secret = _bound_secret()
    resolver, vault, _dao = _resolver(secrets=[secret], grants=[grant])
    vault._by_id[grant.secret_id] = secret

    resolved = await resolver.resolve(
        scope=_scope(),
        ref=GrantRef(endpoint_id=endpoint_id),
        mode=CredentialMode.PROJECT_ONLY,
    )

    assert resolved.owner.kind == CredentialOwnerKind.PROJECT
    assert resolved.owner.user_id is None


@pytest.mark.asyncio
async def test_grant_project_only_does_not_fall_through_to_user_grant():
    """The test most likely to catch a PROJECT_ONLY that behaves like USER_OPTIONAL."""
    endpoint_id = uuid4()
    scope = _scope()
    user_grant = _grant(endpoint_id=endpoint_id, user_id=scope.user_id)
    resolver, _vault, _dao = _resolver(grants=[user_grant])

    with pytest.raises(CredentialNotFoundError) as excinfo:
        await resolver.resolve(
            scope=scope,
            ref=GrantRef(endpoint_id=endpoint_id),
            mode=CredentialMode.PROJECT_ONLY,
        )

    assert excinfo.value.missing == CredentialOwnerKind.PROJECT


@pytest.mark.asyncio
async def test_grant_user_required_does_not_fall_back_to_project_grant():
    """The single most important assertion in this suite."""
    endpoint_id = uuid4()
    scope = _scope()
    project_grant = _grant(endpoint_id=endpoint_id, user_id=None)
    resolver, _vault, _dao = _resolver(grants=[project_grant])

    with pytest.raises(CredentialNotFoundError) as excinfo:
        await resolver.resolve(
            scope=scope,
            ref=GrantRef(endpoint_id=endpoint_id),
            mode=CredentialMode.USER_REQUIRED,
        )

    assert excinfo.value.missing == CredentialOwnerKind.USER
    assert excinfo.value.mode == CredentialMode.USER_REQUIRED


@pytest.mark.asyncio
async def test_grant_user_required_resolves_user_grant():
    endpoint_id = uuid4()
    scope = _scope()
    secret = _bound_secret()
    user_grant = _grant(endpoint_id=endpoint_id, user_id=scope.user_id)
    resolver, vault, _dao = _resolver(grants=[user_grant])
    vault._by_id[user_grant.secret_id] = secret

    resolved = await resolver.resolve(
        scope=scope,
        ref=GrantRef(endpoint_id=endpoint_id),
        mode=CredentialMode.USER_REQUIRED,
    )

    assert resolved.owner.kind == CredentialOwnerKind.USER
    assert resolved.owner.user_id == scope.user_id


@pytest.mark.asyncio
async def test_grant_user_optional_prefers_user_grant_over_project_grant():
    endpoint_id = uuid4()
    scope = _scope()
    user_secret = _bound_secret()
    project_secret = _bound_secret()
    user_grant = _grant(endpoint_id=endpoint_id, user_id=scope.user_id)
    project_grant = _grant(endpoint_id=endpoint_id, user_id=None)
    resolver, vault, _dao = _resolver(grants=[user_grant, project_grant])
    vault._by_id[user_grant.secret_id] = user_secret
    vault._by_id[project_grant.secret_id] = project_secret

    resolved = await resolver.resolve(
        scope=scope,
        ref=GrantRef(endpoint_id=endpoint_id),
        mode=CredentialMode.USER_OPTIONAL,
    )

    assert resolved.owner.kind == CredentialOwnerKind.USER
    assert resolved.secret.id == user_secret.id


@pytest.mark.asyncio
async def test_grant_user_optional_falls_back_to_project_grant():
    endpoint_id = uuid4()
    scope = _scope()
    secret = _bound_secret()
    project_grant = _grant(endpoint_id=endpoint_id, user_id=None)
    resolver, vault, _dao = _resolver(grants=[project_grant])
    vault._by_id[project_grant.secret_id] = secret

    resolved = await resolver.resolve(
        scope=scope,
        ref=GrantRef(endpoint_id=endpoint_id),
        mode=CredentialMode.USER_OPTIONAL,
    )

    assert resolved.owner.kind == CredentialOwnerKind.PROJECT
    assert resolved.owner.user_id is None


@pytest.mark.asyncio
async def test_grant_user_optional_neither_exists_names_user_as_missing():
    endpoint_id = uuid4()
    scope = _scope()
    resolver, _vault, _dao = _resolver()

    with pytest.raises(CredentialNotFoundError) as excinfo:
        await resolver.resolve(
            scope=scope,
            ref=GrantRef(endpoint_id=endpoint_id),
            mode=CredentialMode.USER_OPTIONAL,
        )

    assert excinfo.value.missing == CredentialOwnerKind.USER


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ALL_MODES)
async def test_grant_invalid_raises_before_touching_the_vault(mode):
    endpoint_id = uuid4()
    scope = _scope()
    invalid_grant = _grant(
        endpoint_id=endpoint_id, user_id=scope.user_id, is_valid=False
    )
    project_invalid_grant = _grant(
        endpoint_id=endpoint_id, user_id=None, is_valid=False
    )
    resolver, vault, _dao = _resolver(grants=[invalid_grant, project_invalid_grant])

    with pytest.raises(CredentialInvalidError) as excinfo:
        await resolver.resolve(
            scope=scope, ref=GrantRef(endpoint_id=endpoint_id), mode=mode
        )

    assert excinfo.value.target == f"endpoint:{endpoint_id}"
    assert vault.get_secret_by_id_calls == 0


@pytest.mark.asyncio
async def test_grant_valid_with_dangling_secret_raises_credential_invalid():
    endpoint_id = uuid4()
    grant = _grant(endpoint_id=endpoint_id, user_id=None)
    resolver, _vault, _dao = _resolver(grants=[grant])  # secret_id resolves to nothing

    with pytest.raises(CredentialInvalidError) as excinfo:
        await resolver.resolve(
            scope=_scope(),
            ref=GrantRef(endpoint_id=endpoint_id),
            mode=CredentialMode.PROJECT_ONLY,
        )

    assert excinfo.value.target == f"endpoint:{endpoint_id}"
    assert excinfo.value.detail == "secret missing"


@pytest.mark.asyncio
async def test_grant_not_found_target_is_stable_and_reproducible():
    endpoint_id = uuid4()
    resolver, _vault, _dao = _resolver()

    with pytest.raises(CredentialNotFoundError) as first:
        await resolver.resolve(
            scope=_scope(),
            ref=GrantRef(endpoint_id=endpoint_id),
            mode=CredentialMode.PROJECT_ONLY,
        )
    with pytest.raises(CredentialNotFoundError) as second:
        await resolver.resolve(
            scope=_scope(),
            ref=GrantRef(endpoint_id=endpoint_id),
            mode=CredentialMode.PROJECT_ONLY,
        )

    assert first.value.target == second.value.target == f"endpoint:{endpoint_id}"
    assert first.value.target
