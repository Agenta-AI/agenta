"""LLM endpoint registrar tests.

Hand-written fake endpoints DAO, no database: the mapping is pure and the registrar is
thin over the DAO, so both are exercised in-process.
"""

from uuid import UUID, uuid4

import pytest

from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointCreate,
)
from oss.src.core.gateways.llms.registrar import (
    LLMEndpointRegistrar,
    custom_provider_deployment_kind,
    endpoint_edit_from_create,
    map_custom_provider_secret_to_endpoint,
)
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.enums import LLMCustomProviderKind, SecretKind


PROJECT_ID = uuid4()
USER_ID = uuid4()

# A literal IP keeps the custom_provider URL validator happy without a DNS-shaped host.
BASE_URL = "https://93.184.216.34/v1"


EXPECTED_DEPLOYMENT_KINDS = {
    LLMCustomProviderKind.AZURE: LLMDeploymentKind.AZURE,
    LLMCustomProviderKind.BEDROCK: LLMDeploymentKind.BEDROCK,
    LLMCustomProviderKind.SAGEMAKER: LLMDeploymentKind.SAGEMAKER,
    LLMCustomProviderKind.VERTEX: LLMDeploymentKind.VERTEX,
}


def _custom_provider_secret(
    *,
    kind: str = "custom",
    protocol=None,
    slug: str = "my-gateway-0001",
    name: str = "My gateway",
    secret_id: UUID = None,
    models=("my-model",),
    version="2024-08-01",
) -> SecretResponseDTO:
    data = {
        "kind": kind,
        "provider": {"url": BASE_URL, "version": version, "key": "sk-gw"},
        "models": [{"slug": model} for model in models],
    }
    if protocol is not None:
        data["protocol"] = protocol

    return SecretResponseDTO(
        id=secret_id or uuid4(),
        slug=slug,
        kind=SecretKind.CUSTOM_PROVIDER,
        data=data,
        header={"name": name, "description": "the house gateway"},
    )


def _provider_key_secret() -> SecretResponseDTO:
    return SecretResponseDTO(
        id=uuid4(),
        slug="openai-0001",
        kind=SecretKind.PROVIDER_KEY,
        data={"kind": "openai", "provider": {"key": "sk-test"}},
        header={"name": "OpenAI"},
    )


class _FakeEndpointsDAO:
    """In-memory stand-in for the postgres endpoints DAO, keyed the way it is: by slug
    within a project."""

    def __init__(self):
        self.rows: dict[tuple, LLMEndpoint] = {}
        self.calls: list[tuple] = []
        self.raises = None

    async def fetch_endpoint_by_slug(self, *, project_id, slug):
        self.calls.append(("fetch_endpoint_by_slug", project_id, slug))
        if self.raises is not None:
            raise self.raises
        return self.rows.get((project_id, slug))

    async def create_endpoint(self, *, project_id, user_id, endpoint):
        self.calls.append(("create_endpoint", project_id, user_id, endpoint))
        if self.raises is not None:
            raise self.raises
        row = LLMEndpoint(
            id=uuid4(),
            slug=endpoint.slug,
            name=endpoint.name,
            description=endpoint.description,
            provider_key=endpoint.provider_key,
            deployment_kind=endpoint.deployment_kind,
            secret_id=endpoint.secret_id,
            data=endpoint.data,
            flags=endpoint.flags,
        )
        self.rows[(project_id, endpoint.slug)] = row
        return row

    async def edit_endpoint(self, *, project_id, user_id, endpoint):
        self.calls.append(("edit_endpoint", project_id, user_id, endpoint))
        if self.raises is not None:
            raise self.raises
        return endpoint

    async def delete_endpoint(self, *, project_id, endpoint_id):
        self.calls.append(("delete_endpoint", project_id, endpoint_id))
        if self.raises is not None:
            raise self.raises
        return True


def _named(dao, name):
    return [call for call in dao.calls if call[0] == name]


# --- the pure mapping -------------------------------------------------------- #


@pytest.mark.parametrize("kind", list(LLMCustomProviderKind))
def test_every_custom_provider_kind_maps_onto_a_deployment_kind(kind):
    """No kind is skipped: the four cloud deployments keep their own kind, every other
    kind is a base-url endpoint, which is what CUSTOM means."""
    expected = EXPECTED_DEPLOYMENT_KINDS.get(kind, LLMDeploymentKind.CUSTOM)

    assert custom_provider_deployment_kind(kind) == expected

    endpoint = map_custom_provider_secret_to_endpoint(
        _custom_provider_secret(kind=kind.value)
    )

    assert endpoint is not None
    assert endpoint.deployment_kind == expected


def test_a_missing_protocol_maps_to_the_openai_provider_key():
    endpoint = map_custom_provider_secret_to_endpoint(_custom_provider_secret())

    assert endpoint.provider_key == "openai"


def test_an_anthropic_protocol_maps_to_the_anthropic_provider_key():
    endpoint = map_custom_provider_secret_to_endpoint(
        _custom_provider_secret(protocol="anthropic")
    )

    assert endpoint.provider_key == "anthropic"


def test_an_openai_protocol_maps_to_the_openai_provider_key():
    endpoint = map_custom_provider_secret_to_endpoint(
        _custom_provider_secret(protocol="openai")
    )

    assert endpoint.provider_key == "openai"


def test_the_mapping_carries_the_address_the_models_and_the_identity():
    secret_id = uuid4()
    secret = _custom_provider_secret(
        secret_id=secret_id,
        slug="house-gateway-0007",
        name="House gateway",
        models=("my-model", "my-other-model"),
    )

    endpoint = map_custom_provider_secret_to_endpoint(secret)

    assert endpoint.slug == "house-gateway-0007"
    assert endpoint.name == "House gateway"
    assert endpoint.secret_id == secret_id
    assert endpoint.data.route.base_url == BASE_URL
    assert endpoint.data.route.api_version == "2024-08-01"
    assert endpoint.data.models.allowlist == ["my-model", "my-other-model"]


def test_the_mapping_ignores_a_secret_that_names_no_endpoint():
    assert map_custom_provider_secret_to_endpoint(_provider_key_secret()) is None
    assert (
        map_custom_provider_secret_to_endpoint(_custom_provider_secret(slug=None))
        is None
    )


def test_the_edit_projection_keeps_the_mapped_fields():
    endpoint_id = uuid4()
    create = map_custom_provider_secret_to_endpoint(
        _custom_provider_secret(protocol="anthropic")
    )

    edit = endpoint_edit_from_create(endpoint_id=endpoint_id, endpoint=create)

    assert edit.id == endpoint_id
    assert edit.provider_key == "anthropic"
    assert edit.secret_id == create.secret_id
    assert edit.data == create.data


# --- the registrar ----------------------------------------------------------- #


@pytest.mark.asyncio
async def test_register_creates_the_row_when_the_slug_is_unknown():
    dao = _FakeEndpointsDAO()
    registrar = LLMEndpointRegistrar(llm_endpoints_dao=dao)
    secret = _custom_provider_secret()

    await registrar.register(project_id=PROJECT_ID, user_id=USER_ID, secret=secret)

    creates = _named(dao, "create_endpoint")
    assert len(creates) == 1
    assert creates[0][1] == PROJECT_ID
    assert creates[0][2] == USER_ID
    assert isinstance(creates[0][3], LLMEndpointCreate)
    assert creates[0][3].slug == secret.slug
    assert not _named(dao, "edit_endpoint")


@pytest.mark.asyncio
async def test_register_edits_the_row_when_the_slug_is_already_taken():
    dao = _FakeEndpointsDAO()
    registrar = LLMEndpointRegistrar(llm_endpoints_dao=dao)
    secret = _custom_provider_secret()

    await registrar.register(project_id=PROJECT_ID, user_id=USER_ID, secret=secret)
    await registrar.register(project_id=PROJECT_ID, user_id=USER_ID, secret=secret)

    assert len(_named(dao, "create_endpoint")) == 1
    edits = _named(dao, "edit_endpoint")
    assert len(edits) == 1
    assert edits[0][3].id == dao.rows[(PROJECT_ID, secret.slug)].id


@pytest.mark.asyncio
async def test_register_ignores_a_secret_that_names_no_endpoint():
    dao = _FakeEndpointsDAO()
    registrar = LLMEndpointRegistrar(llm_endpoints_dao=dao)

    await registrar.register(
        project_id=PROJECT_ID, user_id=USER_ID, secret=_provider_key_secret()
    )

    assert dao.calls == []


@pytest.mark.asyncio
async def test_register_swallows_a_dao_failure():
    dao = _FakeEndpointsDAO()
    dao.raises = RuntimeError("the endpoints table is unreachable")
    registrar = LLMEndpointRegistrar(llm_endpoints_dao=dao)

    await registrar.register(
        project_id=PROJECT_ID, user_id=USER_ID, secret=_custom_provider_secret()
    )


@pytest.mark.asyncio
async def test_deregister_deletes_the_row_with_that_slug():
    dao = _FakeEndpointsDAO()
    registrar = LLMEndpointRegistrar(llm_endpoints_dao=dao)
    secret = _custom_provider_secret()
    await registrar.register(project_id=PROJECT_ID, user_id=USER_ID, secret=secret)
    row_id = dao.rows[(PROJECT_ID, secret.slug)].id

    await registrar.deregister(project_id=PROJECT_ID, secret=secret)

    assert _named(dao, "delete_endpoint") == [
        ("delete_endpoint", PROJECT_ID, row_id),
    ]


@pytest.mark.asyncio
async def test_deregister_is_quiet_when_no_row_exists():
    dao = _FakeEndpointsDAO()
    registrar = LLMEndpointRegistrar(llm_endpoints_dao=dao)

    await registrar.deregister(project_id=PROJECT_ID, secret=_custom_provider_secret())

    assert not _named(dao, "delete_endpoint")


@pytest.mark.asyncio
async def test_deregister_swallows_a_dao_failure():
    dao = _FakeEndpointsDAO()
    dao.raises = RuntimeError("the endpoints table is unreachable")
    registrar = LLMEndpointRegistrar(llm_endpoints_dao=dao)

    await registrar.deregister(project_id=PROJECT_ID, secret=_custom_provider_secret())
