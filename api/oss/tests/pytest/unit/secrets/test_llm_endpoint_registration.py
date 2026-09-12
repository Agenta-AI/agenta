"""A custom-provider secret keeps an LLM gateway endpoint in sync.

Hand-written fakes for both collaborators, no database: the vault's job here is to call the
registrar port with the right secret at the right moment, and never to let it fail a write.
"""

from uuid import uuid4

import pytest

from oss.src.core.gateways.llms.registrar import LLMEndpointRegistrar
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    PublicSecretResponseDTO,
    SecretResponseDTO,
    UpdateSecretDTO,
)
from oss.src.core.secrets.enums import LLMEndpointProtocol, SecretKind
from oss.src.core.secrets.redaction import redact_secret_response
from oss.src.core.secrets.services import VaultService


PROJECT_ID = uuid4()
USER_ID = uuid4()

# A literal IP keeps the custom_provider URL validator happy without a DNS-shaped host.
BASE_URL = "https://93.184.216.34/v1"


class _FakeSecretsDAO:
    """Enough of the postgres DAO to exercise create, update and delete, including the two
    callbacks the real DAO invokes under its write lock."""

    def __init__(self):
        self.records: list[SecretResponseDTO] = []

    async def create(self, project_id, organization_id, create_secret_dto, **_):
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

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
        resolve_update=None,
    ):
        del project_id, organization_id, user_id
        stored = next((r for r in self.records if r.id == secret_id), None)
        if stored is None:
            return None

        if resolve_update is not None:
            update_secret_dto = resolve_update(stored, update_secret_dto)

        record = SecretResponseDTO(
            id=stored.id,
            slug=stored.slug,
            kind=stored.kind,
            data=update_secret_dto.secret.data.model_dump(),
            header=update_secret_dto.header or stored.header,
        )
        self.records[self.records.index(stored)] = record
        return record

    async def delete(
        self,
        secret_id,
        project_id,
        organization_id,
        authorize_delete=None,
    ):
        del project_id, organization_id
        stored = next((r for r in self.records if r.id == secret_id), None)
        if stored is None:
            return
        if authorize_delete is not None:
            authorize_delete(stored)
        self.records.remove(stored)


class _FakeRegistrar:
    def __init__(self, *, raises: Exception = None):
        self.registered: list[tuple] = []
        self.deregistered: list[tuple] = []
        self.raises = raises

    async def register(self, *, project_id, user_id=None, secret):
        self.registered.append((project_id, user_id, secret))
        if self.raises is not None:
            raise self.raises

    async def deregister(self, *, project_id, secret):
        self.deregistered.append((project_id, secret))
        if self.raises is not None:
            raise self.raises


class _FakeEndpointsDAO:
    def __init__(self):
        self.created: list = []
        self.edited: list = []

    async def fetch_endpoint_by_slug(self, *, project_id, slug):
        del project_id, slug
        # The row the secret would name does not exist: the pre-change record's case.
        return None

    async def create_endpoint(self, *, project_id, user_id, endpoint):
        del project_id, user_id
        self.created.append(endpoint)
        return None

    async def edit_endpoint(self, *, project_id, user_id, endpoint):
        del project_id, user_id
        self.edited.append(endpoint)
        return None

    async def delete_endpoint(self, *, project_id, endpoint_id):
        del project_id, endpoint_id
        return True


def _custom_provider_payload(*, name="My gateway", protocol=None):
    data = {
        "kind": "custom",
        "provider": {"url": BASE_URL, "version": "2024-08-01", "key": "sk-gw"},
        "models": [{"slug": "my-model"}],
    }
    if protocol is not None:
        data["protocol"] = protocol

    return CreateSecretDTO.model_validate(
        {
            "header": {"name": name},
            "secret": {"kind": "custom_provider", "data": data},
        }
    )


def _custom_provider_update(*, name="Renamed gateway", protocol=None):
    data = {
        "kind": "custom",
        "provider": {"url": BASE_URL, "version": "2025-01-01"},
        "models": [{"slug": "my-model"}, {"slug": "my-other-model"}],
    }
    if protocol is not None:
        data["protocol"] = protocol

    return UpdateSecretDTO.model_validate(
        {
            "header": {"name": name},
            "secret": {"kind": "custom_provider", "data": data},
        }
    )


def _provider_key_payload():
    return CreateSecretDTO.model_validate(
        {
            "header": {"name": "OpenAI"},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": "sk-test"}},
            },
        }
    )


@pytest.fixture
def registrar():
    return _FakeRegistrar()


@pytest.fixture
def vault(registrar):
    return VaultService(_FakeSecretsDAO(), llm_endpoint_registrar=registrar)


# --- the vault drives the port ----------------------------------------------- #


@pytest.mark.asyncio
async def test_creating_a_custom_provider_registers_its_endpoint(vault, registrar):
    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_custom_provider_payload(),
        user_id=USER_ID,
    )

    assert len(registrar.registered) == 1
    project_id, user_id, registered = registrar.registered[0]
    assert project_id == PROJECT_ID
    assert user_id == USER_ID
    assert registered.id == secret.id
    assert registered.slug == secret.slug
    assert registered.kind == SecretKind.CUSTOM_PROVIDER


@pytest.mark.asyncio
async def test_creating_a_provider_key_registers_nothing(vault, registrar):
    await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_payload(),
        user_id=USER_ID,
    )

    assert registrar.registered == []
    assert registrar.deregistered == []


@pytest.mark.asyncio
async def test_updating_a_custom_provider_registers_the_updated_secret(
    vault, registrar
):
    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_custom_provider_payload(),
        user_id=USER_ID,
    )

    await vault.update_secret(
        secret_id=secret.id,
        update_secret_dto=_custom_provider_update(protocol="anthropic"),
        project_id=PROJECT_ID,
        user_id=USER_ID,
    )

    assert len(registrar.registered) == 2
    project_id, user_id, registered = registrar.registered[-1]
    assert project_id == PROJECT_ID
    assert user_id == USER_ID
    assert registered.slug == secret.slug
    assert registered.header.name == "Renamed gateway"
    assert registered.data.protocol == LLMEndpointProtocol.ANTHROPIC
    assert registered.data.provider.version == "2025-01-01"


@pytest.mark.asyncio
async def test_deleting_a_custom_provider_deregisters_its_endpoint(vault, registrar):
    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_custom_provider_payload(),
        user_id=USER_ID,
    )

    await vault.delete_secret(secret_id=secret.id, project_id=PROJECT_ID)

    assert len(registrar.deregistered) == 1
    project_id, deregistered = registrar.deregistered[0]
    assert project_id == PROJECT_ID
    assert deregistered.slug == secret.slug


@pytest.mark.asyncio
async def test_deleting_a_provider_key_deregisters_nothing(vault, registrar):
    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_payload(),
        user_id=USER_ID,
    )

    await vault.delete_secret(secret_id=secret.id, project_id=PROJECT_ID)

    assert registrar.deregistered == []


@pytest.mark.asyncio
async def test_a_vault_without_a_registrar_still_writes():
    vault = VaultService(_FakeSecretsDAO())

    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_custom_provider_payload(),
    )
    updated = await vault.update_secret(
        secret_id=secret.id,
        update_secret_dto=_custom_provider_update(),
        project_id=PROJECT_ID,
    )
    await vault.delete_secret(secret_id=secret.id, project_id=PROJECT_ID)

    assert updated.header.name == "Renamed gateway"


# --- a gateway failure never fails the vault write --------------------------- #


@pytest.mark.asyncio
async def test_a_registrar_that_raises_does_not_fail_the_secret_write():
    failing = _FakeRegistrar(raises=RuntimeError("the gateway is unreachable"))
    vault = VaultService(_FakeSecretsDAO(), llm_endpoint_registrar=failing)

    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_custom_provider_payload(),
        user_id=USER_ID,
    )
    updated = await vault.update_secret(
        secret_id=secret.id,
        update_secret_dto=_custom_provider_update(),
        project_id=PROJECT_ID,
        user_id=USER_ID,
    )
    await vault.delete_secret(secret_id=secret.id, project_id=PROJECT_ID)

    assert secret.id is not None
    assert updated.header.name == "Renamed gateway"
    assert len(failing.registered) == 2
    assert len(failing.deregistered) == 1


# --- update heals a record written before the endpoint existed ---------------- #


@pytest.mark.asyncio
async def test_updating_a_secret_whose_endpoint_row_is_missing_creates_it():
    endpoints_dao = _FakeEndpointsDAO()
    vault = VaultService(
        _FakeSecretsDAO(),
        llm_endpoint_registrar=LLMEndpointRegistrar(
            llm_endpoints_dao=endpoints_dao,
        ),
    )
    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_custom_provider_payload(),
        user_id=USER_ID,
    )

    await vault.update_secret(
        secret_id=secret.id,
        update_secret_dto=_custom_provider_update(),
        project_id=PROJECT_ID,
        user_id=USER_ID,
    )

    # The fake DAO never finds a row, which is exactly the pre-change record's state.
    assert endpoints_dao.edited == []
    assert [endpoint.slug for endpoint in endpoints_dao.created] == [
        secret.slug,
        secret.slug,
    ]
    assert endpoints_dao.created[-1].data.models.allowlist == [
        "my-model",
        "my-other-model",
    ]


# --- the protocol field survives the response DTOs ---------------------------- #


@pytest.mark.asyncio
async def test_the_protocol_round_trips_through_the_secret_dtos(vault):
    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_custom_provider_payload(protocol="anthropic"),
        user_id=USER_ID,
    )

    assert secret.data.protocol == LLMEndpointProtocol.ANTHROPIC

    updated = await vault.update_secret(
        secret_id=secret.id,
        update_secret_dto=_custom_provider_update(protocol="openai"),
        project_id=PROJECT_ID,
        user_id=USER_ID,
    )

    assert updated.data.protocol == LLMEndpointProtocol.OPENAI


@pytest.mark.asyncio
async def test_an_omitted_protocol_stays_absent(vault):
    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_custom_provider_payload(),
        user_id=USER_ID,
    )

    assert secret.data.protocol is None


def test_the_protocol_is_not_redacted_out_of_the_public_response():
    """It describes the endpoint's wire shape, not a credential, so a write-only
    connection still shows it while its key is stripped."""
    stored = SecretResponseDTO(
        id=uuid4(),
        slug="my-gateway-0001",
        kind=SecretKind.CUSTOM_PROVIDER,
        write_only=True,
        data={
            "kind": "custom",
            "provider": {"url": BASE_URL, "key": "sk-gw"},
            "models": [{"slug": "my-model"}],
            "protocol": "anthropic",
        },
        header={"name": "My gateway"},
    )

    public = redact_secret_response(stored)

    assert isinstance(public, PublicSecretResponseDTO)
    assert public.data.protocol == LLMEndpointProtocol.ANTHROPIC
    assert public.data.provider.key is None
    assert public.value_status.configured is True
