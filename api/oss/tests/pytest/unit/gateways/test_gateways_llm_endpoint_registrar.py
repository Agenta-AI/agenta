"""LLM endpoint registrar tests.

Hand-written fake endpoints DAO, no database: the mapping is pure and the registrar is
thin over the DAO, so both are exercised in-process.
"""

from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointCreate,
    LLMEndpointData,
    LLMEndpointFlags,
    LLMEndpointSettings,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.providers.passthrough.auth import build_auth_headers
from oss.src.core.gateways.llms.providers.passthrough.routing import build_url
from oss.src.core.gateways.llms.registrar import (
    LLMEndpointRegistrar,
    custom_provider_deployment_kind,
    endpoint_edit_from_create,
    map_custom_provider_secret_to_endpoint,
)

# The service's own resolved-target type: a private name, imported on purpose so the cloud
# cases below convert a stored endpoint into a route the way a real call does, instead of
# hand-building the route and re-asserting the mapping they are meant to test.
from oss.src.core.gateways.llms.service import _ResolvedLlmTarget
from oss.src.core.gateways.policy.dtos import (
    ResolvedSecret,
    SecretOrigin,
    SecretOwner,
    SecretOwnerKind,
)
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.enums import LLMCustomProviderKind, SecretKind


PROJECT_ID = uuid4()
USER_ID = uuid4()

# A literal IP keeps the custom_provider URL validator happy without a DNS-shaped host.
BASE_URL = "https://93.184.216.34/v1"
# The address the operator repoints the same connection at.
OTHER_BASE_URL = "https://93.184.216.35/v1"


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
    url: str = BASE_URL,
    provider_slug: str = "my-gateway",
) -> SecretResponseDTO:
    data = {
        "kind": kind,
        "provider": {"url": url, "version": version, "key": "sk-gw"},
        "models": [{"slug": model} for model in models],
        "provider_slug": provider_slug,
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
        # A full PUT over the editable surface, exactly as
        # `map_llm_endpoint_edit_to_dbe` applies it: whatever the edit does not carry is
        # gone from the row afterwards.
        row = next(row for row in self.rows.values() if row.id == endpoint.id)
        update = {
            "name": endpoint.name,
            "description": endpoint.description,
            "secret_id": endpoint.secret_id,
            "data": endpoint.data,
            "flags": endpoint.flags,
        }
        # The one field an omission does not clear, as in the real mapping.
        if endpoint.provider_key is not None:
            update["provider_key"] = endpoint.provider_key
        stored = row.model_copy(update=update)
        self.rows[(project_id, stored.slug)] = stored
        return stored

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
    assert endpoint.data.models.allowlist == [
        "my-gateway/custom/my-model",
        "my-gateway/custom/my-other-model",
        "my-model",
        "my-other-model",
    ]


def test_the_allowlist_admits_both_spellings_of_every_listed_model():
    """Agenta addresses the model by its qualified key, a direct HTTP caller by the bare
    slug the upstream knows; both reach the same endpoint, so both must pass."""
    secret = _custom_provider_secret(models=("my-model", "my-other-model"))

    allowlist = map_custom_provider_secret_to_endpoint(secret).data.models.allowlist

    assert secret.data.model_keys == [
        "my-gateway/custom/my-model",
        "my-gateway/custom/my-other-model",
    ]
    assert allowlist == [
        "my-gateway/custom/my-model",
        "my-gateway/custom/my-other-model",
        "my-model",
        "my-other-model",
    ]


def test_the_allowlist_repeats_no_spelling_and_keeps_a_stable_order():
    secret = _custom_provider_secret(models=("my-model", "my-model"))

    allowlist = map_custom_provider_secret_to_endpoint(secret).data.models.allowlist

    assert allowlist == ["my-gateway/custom/my-model", "my-model"]


def test_the_allowlist_leaves_out_a_model_the_operator_did_not_list():
    endpoint = map_custom_provider_secret_to_endpoint(
        _custom_provider_secret(models=("my-model",))
    )

    allowlist = endpoint.data.models.allowlist

    assert "my-unlisted-model" not in allowlist
    assert "my-gateway/custom/my-unlisted-model" not in allowlist
    assert not endpoint.data.models.allows("my-unlisted-model")
    assert not endpoint.data.models.allows("my-gateway/custom/my-unlisted-model")


def test_the_allowlist_falls_back_to_the_bare_slugs_without_model_keys():
    """A secret written before the qualified keys existed still allows its own models."""
    secret = _custom_provider_secret(models=("my-model", "my-other-model"))
    secret.data.model_keys = None

    endpoint = map_custom_provider_secret_to_endpoint(secret)

    assert endpoint.data.models.allowlist == ["my-model", "my-other-model"]


def test_an_empty_model_list_maps_to_an_empty_allowlist_and_not_to_none():
    """`allowlist=[]` allows no model; `allowlist=None` would allow every model, which an
    operator who listed none never asked for."""
    endpoint = map_custom_provider_secret_to_endpoint(
        _custom_provider_secret(models=())
    )

    assert endpoint.data.models.allowlist == []
    assert not endpoint.data.models.allows("my-model")


def test_the_mapping_ignores_a_secret_that_names_no_endpoint():
    assert map_custom_provider_secret_to_endpoint(_provider_key_secret()) is None
    assert (
        map_custom_provider_secret_to_endpoint(_custom_provider_secret(slug=None))
        is None
    )


def _row_from(create: LLMEndpointCreate, **overrides) -> LLMEndpoint:
    """The stored row a mapped endpoint was first created as, plus any later edits."""
    row = LLMEndpoint(
        id=uuid4(),
        slug=create.slug,
        name=create.name,
        description=create.description,
        provider_key=create.provider_key,
        deployment_kind=create.deployment_kind,
        secret_id=create.secret_id,
        data=create.data,
        flags=create.flags,
    )
    return row.model_copy(update=overrides) if overrides else row


def test_the_edit_projection_keeps_the_mapped_fields():
    create = map_custom_provider_secret_to_endpoint(
        _custom_provider_secret(protocol="anthropic")
    )
    stored = _row_from(create)

    edit = endpoint_edit_from_create(
        endpoint_id=stored.id, endpoint=create, stored=stored
    )

    assert edit.id == stored.id
    assert edit.provider_key == "anthropic"
    assert edit.secret_id == create.secret_id
    assert edit.data == create.data


# --- field ownership: a secret save is not an endpoint reconfiguration -------- #


def _governed(row: LLMEndpoint) -> LLMEndpoint:
    """The row after an administrator disabled it, denied a model and capped its output."""
    return row.model_copy(
        update={
            "flags": LLMEndpointFlags(is_active=False),
            "data": LLMEndpointData(
                route=row.data.route.model_copy(
                    update={"headers": {"x-tenant": "acme"}}
                ),
                models=row.data.models.model_copy(update={"denylist": ["my-model"]}),
                settings=LLMEndpointSettings(max_output_tokens=256),
            ),
            "tags": {"owner": "platform"},
        }
    )


def test_the_edit_projection_leaves_the_endpoints_governance_fields_alone():
    """Gateway policy is configured against the endpoint, not against the connection, so
    re-saving the connection must not restate it."""
    stored = _governed(
        _row_from(map_custom_provider_secret_to_endpoint(_custom_provider_secret()))
    )
    rotated = map_custom_provider_secret_to_endpoint(_custom_provider_secret())

    edit = endpoint_edit_from_create(
        endpoint_id=stored.id, endpoint=rotated, stored=stored
    )

    assert edit.flags.is_active is False
    assert edit.data.models.denylist == ["my-model"]
    assert edit.data.settings.max_output_tokens == 256
    assert edit.data.route.headers == {"x-tenant": "acme"}
    assert edit.tags == {"owner": "platform"}


def test_the_edit_projection_rewrites_the_fields_the_connection_owns():
    """The other half of the split: what the secret owns does follow the secret."""
    stored = _governed(
        _row_from(map_custom_provider_secret_to_endpoint(_custom_provider_secret()))
    )
    rotated_id = uuid4()
    rotated = map_custom_provider_secret_to_endpoint(
        _custom_provider_secret(
            secret_id=rotated_id,
            name="Renamed gateway",
            models=("my-model", "my-other-model"),
            version="2025-01-01",
            protocol="anthropic",
        )
    )

    edit = endpoint_edit_from_create(
        endpoint_id=stored.id, endpoint=rotated, stored=stored
    )

    assert edit.secret_id == rotated_id
    assert edit.name == "Renamed gateway"
    assert edit.provider_key == "anthropic"
    assert edit.data.route.api_version == "2025-01-01"
    assert edit.data.models.allowlist == [
        "my-gateway/custom/my-model",
        "my-gateway/custom/my-other-model",
        "my-model",
        "my-other-model",
    ]


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
async def test_saving_a_secret_leaves_the_endpoints_governance_fields_alone():
    """Rotating a provider key is not a reconfiguration of the endpoint: an endpoint an
    administrator disabled stays disabled, with its denylist and its ceiling."""
    dao = _FakeEndpointsDAO()
    registrar = LLMEndpointRegistrar(llm_endpoints_dao=dao)
    connection = _custom_provider_secret()

    await registrar.register(project_id=PROJECT_ID, user_id=USER_ID, secret=connection)
    row_key = (PROJECT_ID, connection.slug)
    dao.rows[row_key] = _governed(dao.rows[row_key])

    await registrar.register(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        secret=_custom_provider_secret(
            secret_id=connection.id,
            url=OTHER_BASE_URL,
            version="2025-01-01",
            models=("my-model", "my-other-model"),
        ),
    )

    row = dao.rows[row_key]
    assert row.flags.is_active is False
    assert row.data.models.denylist == ["my-model"]
    assert row.data.settings.max_output_tokens == 256
    assert row.data.route.headers == {"x-tenant": "acme"}


@pytest.mark.asyncio
async def test_saving_a_secret_does_write_the_credential_and_routing_fields():
    """The same save, from the other side: what the connection owns follows the save."""
    dao = _FakeEndpointsDAO()
    registrar = LLMEndpointRegistrar(llm_endpoints_dao=dao)
    connection = _custom_provider_secret()

    await registrar.register(project_id=PROJECT_ID, user_id=USER_ID, secret=connection)
    row_key = (PROJECT_ID, connection.slug)
    dao.rows[row_key] = _governed(dao.rows[row_key])
    rotated_id = uuid4()

    await registrar.register(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        secret=_custom_provider_secret(
            secret_id=rotated_id,
            url=OTHER_BASE_URL,
            version="2025-01-01",
            models=("my-model", "my-other-model"),
            protocol="anthropic",
        ),
    )

    row = dao.rows[row_key]
    assert row.secret_id == rotated_id
    assert row.provider_key == "anthropic"
    assert row.data.route.base_url == OTHER_BASE_URL
    assert row.data.route.api_version == "2025-01-01"
    assert row.data.models.allowlist == [
        "my-gateway/custom/my-model",
        "my-gateway/custom/my-other-model",
        "my-model",
        "my-other-model",
    ]


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


# --- a cloud provider configuration becomes a working endpoint ---------------- #


# The vault's names for the cloud routing fields, as the connection form writes them
# (`web/packages/agenta-entities/src/secret/core/transforms.ts`). Synthetic values.
BEDROCK_EXTRAS = {
    "aws_region_name": "eu-central-1",
    "aws_bearer_token_bedrock": "bedrock-token-0001",
}
VERTEX_EXTRAS = {
    "vertex_ai_project": "my-project",
    "vertex_ai_location": "europe-west4",
    "vertex_ai_credentials": '{"type": "service_account"}',
}


def _cloud_provider_secret(
    *,
    kind: str,
    extras: dict,
    url: str = None,
    models=("my-model",),
) -> SecretResponseDTO:
    """A cloud connection as the vault holds it: routing configuration and credential
    material side by side in `provider.extras`, with no base URL."""
    return SecretResponseDTO(
        id=uuid4(),
        slug="my-cloud-0001",
        kind=SecretKind.CUSTOM_PROVIDER,
        data={
            "kind": kind,
            "provider": {"url": url, "extras": extras},
            "models": [{"slug": model} for model in models],
            "provider_slug": "my-cloud",
        },
        header={"name": "My cloud"},
    )


def _resolved_route(endpoint: LLMEndpointCreate, *, model: str) -> LLMResolvedRoute:
    """The route a call on this registered endpoint resolves to.

    Built by the service's own resolved-target type, so the test follows the same path a
    request does: asserting on the mapped dictionary instead is what let the missing
    fields through.
    """
    target = _ResolvedLlmTarget(
        namespace=GatewayEndpointNamespace.CUSTOM,
        name=endpoint.slug,
        provider_key=endpoint.provider_key,
        deployment_kind=endpoint.deployment_kind,
        models=endpoint.data.models,
        route_data=endpoint.data.route,
        settings=endpoint.data.settings,
        secret_id=endpoint.secret_id,
    )
    return target.route(LLMCallContext(model=model))


def _resolved(connection: SecretResponseDTO) -> ResolvedSecret:
    return ResolvedSecret(
        secret=connection,
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


def test_a_bedrock_region_only_configuration_routes_through_its_region():
    """Bedrock takes a base URL *or* a region, so a region-only connection is complete —
    and it is the one the dropped field left unroutable."""
    endpoint = map_custom_provider_secret_to_endpoint(
        _cloud_provider_secret(kind="bedrock", extras=BEDROCK_EXTRAS)
    )

    assert endpoint.data.route.region == "eu-central-1"
    assert (
        build_url(
            _resolved_route(endpoint, model="my-model"),
            LLMProtocol.CHAT_COMPLETIONS,
        )
        == "https://bedrock-mantle.eu-central-1.api.aws/v1/chat/completions"
    )


def test_a_bedrock_configuration_with_a_base_url_still_routes_through_that_url():
    """The alternative half of the same rule: a stored base URL wins over the region."""
    endpoint = map_custom_provider_secret_to_endpoint(
        _cloud_provider_secret(kind="bedrock", extras=BEDROCK_EXTRAS, url=BASE_URL)
    )

    assert (
        build_url(
            _resolved_route(endpoint, model="my-model"),
            LLMProtocol.CHAT_COMPLETIONS,
        )
        == f"{BASE_URL}/v1/chat/completions"
    )


@pytest.mark.asyncio
async def test_a_bedrock_region_only_configuration_authenticates_its_request():
    connection = _cloud_provider_secret(kind="bedrock", extras=BEDROCK_EXTRAS)
    route = _resolved_route(
        map_custom_provider_secret_to_endpoint(connection), model="my-model"
    )

    headers = await build_auth_headers(route, _resolved(connection))

    assert headers == {"Authorization": "Bearer bedrock-token-0001"}


def test_a_vertex_configuration_routes_through_its_project_and_location():
    endpoint = map_custom_provider_secret_to_endpoint(
        _cloud_provider_secret(kind="vertex_ai", extras=VERTEX_EXTRAS)
    )

    # The two sides spell the project differently; the route's spelling is what the
    # routing and auth strategies read.
    assert endpoint.data.route.region == "europe-west4"
    assert endpoint.data.route.extras == {"vertex_project": "my-project"}
    assert build_url(
        _resolved_route(endpoint, model="my-model"),
        LLMProtocol.CHAT_COMPLETIONS,
    ) == (
        "https://europe-west4-aiplatform.googleapis.com/v1/projects/my-project"
        "/locations/europe-west4/endpoints/openapi/chat/completions"
    )


@pytest.mark.asyncio
async def test_a_vertex_configuration_mints_a_token_for_its_own_project():
    """Vertex authentication refuses without `extras.vertex_project`, so the registrar's
    translation is what makes the endpoint usable at all."""
    connection = _cloud_provider_secret(kind="vertex_ai", extras=VERTEX_EXTRAS)
    route = _resolved_route(
        map_custom_provider_secret_to_endpoint(connection), model="my-model"
    )

    with patch(
        "litellm.llms.vertex_ai.vertex_llm_base.VertexBase.get_access_token_async",
        new_callable=AsyncMock,
        return_value=("minted-token", "my-project"),
    ) as mocked:
        headers = await build_auth_headers(route, _resolved(connection))

    assert headers == {"Authorization": "Bearer minted-token"}
    mocked.assert_awaited_once_with(
        credentials={"type": "service_account"}, project_id="my-project"
    )


def test_a_connection_with_no_cloud_routing_configuration_carries_none():
    """The plain case stays empty: no region invented, no empty extras dictionary stored."""
    endpoint = map_custom_provider_secret_to_endpoint(_custom_provider_secret())

    assert endpoint.data.route.region is None
    assert endpoint.data.route.extras is None
