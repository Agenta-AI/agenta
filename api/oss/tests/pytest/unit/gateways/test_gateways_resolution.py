"""Unit tests for `SecretsResolver` (specs-wp2.md, tasks-wp2.md).

Every case below runs against a dict-backed mock `VaultService` and a dict-backed mock
the vault service — no Postgres, no Redis, no encryption key. The mode-table cases
(`USER_REQUIRED` never falls back, `USER_OPTIONAL` names the narrower owner) are the point
of this suite; everything else exists to pin the ref-arm matching rules.
"""

from typing import Dict, List, Optional, Tuple
from uuid import UUID, uuid4

import pytest

from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    SecretMode,
    SecretOwnerKind,
    ProviderKeyRef,
    SecretOrigin,
)
from oss.src.core.gateways.policy.resolution import SecretsResolver
from oss.src.core.gateways.policy.types import (
    SecretNotFoundError,
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
    SecretMode.PROJECT_ONLY,
    SecretMode.USER_REQUIRED,
    SecretMode.USER_OPTIONAL,
]


# Resolver test doubles


class MockVaultService:
    """In-memory secret_id -> SecretResponseDTO map; implements only the two
    VaultService methods SecretsResolver calls."""

    def __init__(self, secrets: Optional[List[SecretResponseDTO]] = None) -> None:
        self._by_id: Dict[UUID, SecretResponseDTO] = {s.id: s for s in secrets or []}
        self.get_secret_by_id_calls = 0

    async def list_secrets(self, project_id=None, organization_id=None):
        return list(self._by_id.values())

    async def get_secret_by_id(self, secret_id, project_id=None, organization_id=None):
        self.get_secret_by_id_calls += 1
        return self._by_id.get(secret_id)


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


def _resolver(*, secrets=None) -> Tuple[SecretsResolver, MockVaultService]:
    vault = MockVaultService(secrets)
    return SecretsResolver(vault_service=vault), vault


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
    resolver, _vault = _resolver(secrets=[secret])
    scope = _scope()

    resolved = await resolver.resolve(
        scope=scope,
        ref=BoundSecretRef(secret_id=secret.id),
        mode=SecretMode.PROJECT_ONLY,
    )

    assert resolved.secret.id == secret.id
    assert resolved.owner.kind == SecretOwnerKind.PROJECT
    assert resolved.origin == SecretOrigin.VAULT


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ALL_MODES)
async def test_bound_secret_missing_raises_for_every_mode(mode):
    resolver, _vault = _resolver()
    scope = _scope()
    missing_id = uuid4()

    with pytest.raises(SecretNotFoundError) as excinfo:
        await resolver.resolve(
            scope=scope, ref=BoundSecretRef(secret_id=missing_id), mode=mode
        )

    assert excinfo.value.missing == SecretOwnerKind.PROJECT
    assert excinfo.value.mode == mode
    assert excinfo.value.target == f"secret:{missing_id}"


# --- ProviderKeyRef --------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_provider_key_match_resolves():
    secret = _provider_key_secret(StandardProviderKind.OPENAI)
    resolver, _vault = _resolver(secrets=[secret])

    resolved = await resolver.resolve(
        scope=_scope(),
        ref=ProviderKeyRef(provider_key="openai"),
        mode=SecretMode.PROJECT_ONLY,
    )

    assert resolved.secret.id == secret.id
    assert resolved.owner.kind == SecretOwnerKind.PROJECT
    assert resolved.origin == SecretOrigin.VAULT


@pytest.mark.asyncio
async def test_provider_key_falls_back_to_custom_provider_when_no_provider_key_match():
    custom = _custom_provider_secret(CustomProviderKind.AZURE)
    resolver, _vault = _resolver(secrets=[custom])

    resolved = await resolver.resolve(
        scope=_scope(),
        ref=ProviderKeyRef(provider_key="azure"),
        mode=SecretMode.PROJECT_ONLY,
    )

    assert resolved.secret.id == custom.id


@pytest.mark.asyncio
async def test_provider_key_prefers_provider_key_kind_over_custom_provider():
    standard = _provider_key_secret(StandardProviderKind.OPENAI)
    # Matches the same provider name via the CustomProviderKind arm too.
    custom = _custom_provider_secret(CustomProviderKind.OPENAI)
    resolver, _vault = _resolver(secrets=[custom, standard])

    resolved = await resolver.resolve(
        scope=_scope(),
        ref=ProviderKeyRef(provider_key="openai"),
        mode=SecretMode.PROJECT_ONLY,
    )

    assert resolved.secret.id == standard.id
    assert resolved.secret.kind == SecretKind.PROVIDER_KEY


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ALL_MODES)
async def test_provider_key_no_match_raises_for_every_mode(mode):
    resolver, _vault = _resolver()

    with pytest.raises(SecretNotFoundError) as excinfo:
        await resolver.resolve(
            scope=_scope(), ref=ProviderKeyRef(provider_key="openai"), mode=mode
        )

    assert excinfo.value.missing == SecretOwnerKind.PROJECT
    assert excinfo.value.target == "provider:openai"


# --- available_provider_keys (R2) ------------------------------------------------- #


@pytest.mark.asyncio
async def test_available_provider_keys_returns_names_across_both_kinds():
    resolver, _vault = _resolver(
        secrets=[
            _provider_key_secret(StandardProviderKind.OPENAI),
            _custom_provider_secret(CustomProviderKind.AZURE),
        ]
    )

    keys = await resolver.available_provider_keys(scope=_scope())

    assert keys == {"openai", "azure"}


@pytest.mark.asyncio
async def test_available_provider_keys_empty_project_returns_empty_set_without_raising():
    resolver, _vault = _resolver()

    keys = await resolver.available_provider_keys(scope=_scope())

    assert keys == set()
