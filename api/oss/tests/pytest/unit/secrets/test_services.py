from uuid import uuid4

import pytest

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretResponseDTO,
    UpdateSecretDTO,
)
from oss.src.core.secrets.enums import SecretKind, StandardProviderKind
from oss.src.core.secrets.services import VaultService, next_provider_key_name


class _FakeSecretsDAO:
    """In-memory stand-in for the postgres DAO: enough to exercise create + list + update."""

    def __init__(self):
        self.records: list[SecretResponseDTO] = []

    async def create(self, project_id, organization_id, create_secret_dto):
        del project_id, organization_id
        record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
        )
        self.records.append(record)
        return record

    async def list(self, project_id, organization_id):
        del project_id, organization_id
        return list(self.records)

    async def get_by_id(self, secret_id, project_id, organization_id):
        del project_id, organization_id
        return next(
            (record for record in self.records if record.id == secret_id),
            None,
        )

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
    ):
        del project_id, organization_id, user_id
        stored = next(
            (record for record in self.records if record.id == secret_id),
            None,
        )
        if stored is None:
            return None
        # Like the postgres mapping, the whole data blob is replaced: whatever the payload
        # omits is gone unless the service carried it over first.
        record = SecretResponseDTO(
            id=stored.id,
            slug=stored.slug,
            kind=stored.kind,
            data=update_secret_dto.secret.data.model_dump(),
            header=update_secret_dto.header or stored.header,
        )
        self.records[self.records.index(stored)] = record
        return record


def _provider_key_payload(kind="openai", name=None, **data):
    return CreateSecretDTO.model_validate(
        {
            # A connection created without a name is the case the naming rule exists for.
            "header": {"name": name} if name else {},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": kind, "provider": {"key": "sk-test"}, **data},
            },
        }
    )


def _provider_key_update(**data):
    return UpdateSecretDTO.model_validate(
        {
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": "sk-rotated"}, **data},
            },
        }
    )


def _custom_provider_payload(name="My gateway", slug=None):
    payload = {
        "header": {"name": name},
        "secret": {
            "kind": "custom_provider",
            "data": {
                "kind": "openai",
                "provider": {"url": "https://93.184.216.34/v1", "key": "sk-gw"},
                "models": [{"slug": "my-model"}],
            },
        },
    }
    if slug:
        payload["slug"] = slug
    return CreateSecretDTO.model_validate(payload)


@pytest.fixture
def vault():
    return VaultService(_FakeSecretsDAO())


def test_next_provider_key_name_numbers_later_connections():
    assert (
        next_provider_key_name(kind=StandardProviderKind.OPENAI, taken_names=set())
        == "OpenAI"
    )
    assert (
        next_provider_key_name(kind=StandardProviderKind.OPENAI, taken_names={"OpenAI"})
        == "OpenAI 2"
    )
    assert (
        next_provider_key_name(
            kind=StandardProviderKind.OPENAI, taken_names={"OpenAI", "OpenAI 2"}
        )
        == "OpenAI 3"
    )
    # A gap is reused rather than skipped.
    assert (
        next_provider_key_name(
            kind=StandardProviderKind.OPENAI, taken_names={"OpenAI", "OpenAI 3"}
        )
        == "OpenAI 2"
    )


def test_next_provider_key_name_uses_the_provider_display_name():
    assert (
        next_provider_key_name(kind=StandardProviderKind.GEMINI, taken_names=set())
        == "Google Gemini"
    )
    assert (
        next_provider_key_name(kind=StandardProviderKind.TOGETHERAI, taken_names=set())
        == "Together AI"
    )


async def test_create_names_and_slugs_unnamed_provider_keys(vault):
    first = await vault.create_secret(
        project_id=uuid4(), create_secret_dto=_provider_key_payload()
    )
    second = await vault.create_secret(
        project_id=uuid4(), create_secret_dto=_provider_key_payload()
    )

    assert first.header.name == "OpenAI"
    assert second.header.name == "OpenAI 2"
    assert first.slug and second.slug and first.slug != second.slug
    assert first.slug.startswith("openai-")
    assert second.slug.startswith("openai-2-")


async def test_create_keeps_a_user_supplied_name_and_still_assigns_a_slug(vault):
    secret = await vault.create_secret(
        project_id=uuid4(),
        create_secret_dto=_provider_key_payload(name="Billing team key"),
    )

    assert secret.header.name == "Billing team key"
    assert secret.slug.startswith("billing-team-key-")


async def test_create_numbers_per_provider_display_name(vault):
    await vault.create_secret(
        project_id=uuid4(), create_secret_dto=_provider_key_payload()
    )
    anthropic = await vault.create_secret(
        project_id=uuid4(), create_secret_dto=_provider_key_payload(kind="anthropic")
    )

    # A second provider family starts at its own name, not at "2".
    assert anthropic.header.name == "Anthropic"


async def test_create_stores_the_saved_models_and_harnesses(vault):
    secret = await vault.create_secret(
        project_id=uuid4(),
        create_secret_dto=_provider_key_payload(
            models=[{"slug": "gpt-5.6-luna"}], harnesses=["pi_core"]
        ),
    )

    assert secret.kind == SecretKind.PROVIDER_KEY
    assert [model.slug for model in secret.data.models] == ["gpt-5.6-luna"]
    assert secret.data.harnesses == ["pi_core"]


async def test_create_slugs_a_custom_provider_from_its_name(vault):
    secret = await vault.create_secret(
        project_id=uuid4(), create_secret_dto=_custom_provider_payload()
    )

    # The slug is identity, so a later rename of the display name cannot move the connection.
    assert secret.slug.startswith("my-gateway-")


async def test_create_keeps_a_custom_provider_slug_the_caller_supplied(vault):
    secret = await vault.create_secret(
        project_id=uuid4(),
        create_secret_dto=_custom_provider_payload(slug="my-own-slug"),
    )

    assert secret.slug == "my-own-slug"


@pytest.fixture
async def saved_connection(vault):
    return await vault.create_secret(
        project_id=uuid4(),
        create_secret_dto=_provider_key_payload(
            name="OpenAI", models=[{"slug": "gpt-5.6-luna"}], harnesses=["pi_core"]
        ),
    )


async def test_update_preserves_saved_policy_the_payload_omits(vault, saved_connection):
    # Rotating the key from another surface says nothing about models or harnesses.
    updated = await vault.update_secret(
        secret_id=saved_connection.id,
        update_secret_dto=_provider_key_update(),
        project_id=uuid4(),
    )

    assert [model.slug for model in updated.data.models] == ["gpt-5.6-luna"]
    assert updated.data.harnesses == ["pi_core"]
    assert updated.data.provider.key == "sk-rotated"


async def test_update_with_an_empty_list_clears_the_saved_policy(
    vault, saved_connection
):
    updated = await vault.update_secret(
        secret_id=saved_connection.id,
        update_secret_dto=_provider_key_update(models=[], harnesses=[]),
        project_id=uuid4(),
    )

    # An explicit empty list is a choice ("offer nothing"), not an omission.
    assert updated.data.models == []
    assert updated.data.harnesses == []


async def test_update_with_a_new_list_replaces_the_saved_policy(
    vault, saved_connection
):
    updated = await vault.update_secret(
        secret_id=saved_connection.id,
        update_secret_dto=_provider_key_update(
            models=[{"slug": "gpt-5.6-sol"}], harnesses=["codex"]
        ),
        project_id=uuid4(),
    )

    assert [model.slug for model in updated.data.models] == ["gpt-5.6-sol"]
    assert updated.data.harnesses == ["codex"]
