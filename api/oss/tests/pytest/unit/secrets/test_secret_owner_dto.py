"""The owner type and the organization DTO rules (M5, Task 2)."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from oss.src.core.secrets import enums as secret_enums
from oss.src.core.secrets.dtos import (
    CachedEffectiveSecrets,
    SecretOwner,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.src.utils.caching import _deserialize, _serialize


def _secret(*, owner=None, write_only=False, **extra) -> SecretResponseDTO:
    body = {
        "id": str(uuid4()),
        "slug": "openai-company",
        "kind": "provider_key",
        "data": {"kind": "openai", "provider": {"key": "sk-m5sentinel-owner-dto"}},
        "header": {"name": "OpenAI"},
        "write_only": write_only,
        **extra,
    }
    if owner is not None:
        body["owner"] = owner.model_dump(mode="json")
    return SecretResponseDTO.model_validate(body)


def test_secret_owner_is_frozen_and_needs_an_id():
    owner = SecretOwner(kind=SecretOwnerKind.ORGANIZATION, id=uuid4())
    with pytest.raises(ValidationError):
        owner.kind = SecretOwnerKind.PROJECT  # type: ignore[misc]
    with pytest.raises(ValidationError):
        SecretOwner(kind=SecretOwnerKind.PROJECT)  # type: ignore[call-arg]


def test_organization_rows_are_forced_write_only():
    owner = SecretOwner(kind=SecretOwnerKind.ORGANIZATION, id=uuid4())
    secret = _secret(owner=owner, write_only=False)
    assert secret.write_only is True

    # Rehydration from a dumped dict (as the cache does) keeps the rule.
    dumped = secret.model_dump(mode="json")
    dumped["write_only"] = False
    assert SecretResponseDTO.model_validate(dumped).write_only is True


def test_project_rows_keep_their_write_only_choice():
    owner = SecretOwner(kind=SecretOwnerKind.PROJECT, id=uuid4())
    assert _secret(owner=owner, write_only=False).write_only is False
    assert _secret(owner=owner, write_only=True).write_only is True
    assert _secret(write_only=False).write_only is False


def test_cached_effective_secrets_round_trips_the_real_serializer():
    project_id, organization_id = uuid4(), uuid4()
    project_row = _secret(
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT, id=project_id)
    )
    organization_row = _secret(
        owner=SecretOwner(kind=SecretOwnerKind.ORGANIZATION, id=organization_id),
        availability="all_projects",
    )
    entry = CachedEffectiveSecrets(
        project_id=project_id,
        organization_id=organization_id,
        secrets=[project_row],
        organization=[organization_row],
    )

    restored = _deserialize(_serialize(entry), model=CachedEffectiveSecrets)

    assert restored == entry
    assert restored.organization[0].write_only is True
    assert restored.organization[0].selected_project_ids is None


def test_cached_effective_secrets_with_none_fields_round_trips():
    entry = CachedEffectiveSecrets(project_id=uuid4())
    restored = _deserialize(_serialize(entry), model=CachedEffectiveSecrets)
    assert restored == entry
    assert restored.organization_id is None
    assert restored.secrets == [] and restored.organization == []


def test_bound_secret_ref_defaults_to_project_owner():
    from oss.src.core.gateways.policy.dtos import BoundSecretRef

    ref = BoundSecretRef(secret_id=uuid4())
    assert ref.owner_kind == SecretOwnerKind.PROJECT


def test_gateway_policy_reuses_the_core_owner_types():
    from oss.src.core.gateways.policy import dtos as policy_dtos
    from oss.src.core.secrets import dtos as secret_dtos

    assert policy_dtos.SecretOwnerKind is secret_enums.SecretOwnerKind
    assert policy_dtos.SecretOwner is secret_dtos.SecretOwner
    assert "user_id" not in policy_dtos.SecretOwner.model_fields
