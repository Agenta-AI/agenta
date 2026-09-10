from uuid import uuid4

import pytest

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretResponseDTO,
    UpdateSecretDTO,
)
from oss.src.core.secrets.enums import SecretKind, StandardProviderKind
from oss.src.core.secrets.managed import SecretManagementDTO, SecretManager
from oss.src.core.secrets.services import VaultService, next_provider_key_name


PROJECT_ID = uuid4()
OTHER_PROJECT_ID = uuid4()


class _FakeSecretsDAO:
    """In-memory stand-in for the postgres DAO: enough to exercise create + list + update.

    Records carry their scope and every read filters on it, like the real DAO — otherwise a
    test could see provider numbering or saved policy cross a project boundary.
    """

    def __init__(self):
        self.records: list[tuple[tuple, SecretResponseDTO]] = []

    def _scoped(self, project_id, organization_id):
        return [
            record
            for scope, record in self.records
            if scope == (project_id, organization_id)
        ]

    async def create(
        self, project_id, organization_id, create_secret_dto, management=None
    ):
        record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
            management=management,
        )
        self.records.append(((project_id, organization_id), record))
        return record

    async def create_with_derived_naming(
        self,
        project_id,
        organization_id,
        create_secret_dto,
        lock_scope,
        derive_naming,
        management=None,
    ):
        # The postgres DAO holds an advisory lock on `lock_scope` so the read, the naming and
        # the write are one atomic step. Nothing here runs concurrently, so only the ordering
        # matters: the payload is named against the scope's current records, then written.
        del lock_scope
        derive_naming(self._scoped(project_id, organization_id))
        return await self.create(
            project_id, organization_id, create_secret_dto, management
        )

    async def list(self, project_id, organization_id):
        return self._scoped(project_id, organization_id)

    async def get_by_id(self, secret_id, project_id, organization_id):
        return next(
            (
                record
                for record in self._scoped(project_id, organization_id)
                if record.id == secret_id
            ),
            None,
        )

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
        resolve_update=None,
    ):
        del user_id
        scope = (project_id, organization_id)
        stored = next(
            (record for record in self._scoped(*scope) if record.id == secret_id),
            None,
        )
        if stored is None:
            return None

        # Production resolves the update against the row under the write lock; the fake
        # does the same at the same point, so keep-on-omit is exercised, not skipped.
        if resolve_update is not None:
            update_secret_dto = resolve_update(stored, update_secret_dto)
        # Like the postgres mapping, the whole data blob is replaced: whatever the payload
        # omits is gone unless the service carried it over first.
        record = SecretResponseDTO(
            id=stored.id,
            slug=stored.slug,
            kind=stored.kind,
            data=update_secret_dto.secret.data.model_dump(),
            header=update_secret_dto.header or stored.header,
        )
        self.records[self.records.index((scope, stored))] = (scope, record)
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
        project_id=PROJECT_ID, create_secret_dto=_provider_key_payload()
    )
    second = await vault.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_payload()
    )

    assert first.header.name == "OpenAI"
    assert second.header.name == "OpenAI 2"
    assert first.slug and second.slug and first.slug != second.slug
    assert first.slug.startswith("openai-")
    assert second.slug.startswith("openai-2-")


async def test_managed_create_keeps_its_management_while_deriving_a_name(vault):
    """A managed connection created unnamed is still managed.

    Deriving the name takes its own DAO path, so `management` has to be carried down it —
    losing it would silently turn a manager-owned credential into an ordinary editable one.
    """
    secret = await vault.create_managed_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_payload(),
        management=SecretManagementDTO(manager=SecretManager.STARTER_CREDITS_BRIDGE),
    )

    assert secret.header.name == "OpenAI"
    assert secret.management is not None
    assert secret.management.manager is SecretManager.STARTER_CREDITS_BRIDGE


async def test_create_keeps_a_user_supplied_name_and_still_assigns_a_slug(vault):
    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_payload(name="Billing team key"),
    )

    assert secret.header.name == "Billing team key"
    assert secret.slug.startswith("billing-team-key-")


async def test_create_numbers_per_provider_display_name(vault):
    await vault.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_payload()
    )
    anthropic = await vault.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_payload(kind="anthropic")
    )

    # A second provider family starts at its own name, not at "2".
    assert anthropic.header.name == "Anthropic"


async def test_numbering_does_not_cross_a_project_boundary(vault):
    """Numbering counts one project's connections; another project's are not "taken"."""
    await vault.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_payload()
    )
    elsewhere = await vault.create_secret(
        project_id=OTHER_PROJECT_ID, create_secret_dto=_provider_key_payload()
    )

    assert elsewhere.header.name == "OpenAI"


async def test_create_stores_the_saved_models_and_harnesses(vault):
    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_payload(
            models=[{"slug": "gpt-5.6-luna"}], harnesses=["pi_core"]
        ),
    )

    assert secret.kind == SecretKind.PROVIDER_KEY
    assert [model.slug for model in secret.data.models] == ["gpt-5.6-luna"]
    assert secret.data.harnesses == ["pi_core"]


async def test_create_slugs_a_custom_provider_from_its_name(vault):
    secret = await vault.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_custom_provider_payload()
    )

    # The slug is identity, so a later rename of the display name cannot move the connection.
    assert secret.slug.startswith("my-gateway-")


async def test_create_keeps_a_custom_provider_slug_the_caller_supplied(vault):
    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_custom_provider_payload(slug="my-own-slug"),
    )

    assert secret.slug == "my-own-slug"


@pytest.fixture
async def saved_connection(vault):
    return await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_payload(
            name="OpenAI", models=[{"slug": "gpt-5.6-luna"}], harnesses=["pi_core"]
        ),
    )


async def test_update_preserves_saved_policy_the_payload_omits(vault, saved_connection):
    # Rotating the key from another surface says nothing about models or harnesses.
    updated = await vault.update_secret(
        secret_id=saved_connection.id,
        update_secret_dto=_provider_key_update(),
        project_id=PROJECT_ID,
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
        project_id=PROJECT_ID,
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
        project_id=PROJECT_ID,
    )

    assert [model.slug for model in updated.data.models] == ["gpt-5.6-sol"]
    assert updated.data.harnesses == ["codex"]


async def test_update_does_not_reach_across_a_project_boundary(vault, saved_connection):
    updated = await vault.update_secret(
        secret_id=saved_connection.id,
        update_secret_dto=_provider_key_update(),
        project_id=OTHER_PROJECT_ID,
    )

    assert updated is None
