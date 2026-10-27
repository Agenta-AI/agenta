"""Organization connections in the LLM gateway, and the one-pass project slug resolve (M5).

The LLM gateway service with a real LLM-plane `SecretsResolver` over a real
`VaultService` (in-memory owner-based DAO, recording cache engine), and an in-memory
endpoints DAO. An agent names an organization connection with scope `organization`; it
resolves in the `organization` namespace and nowhere else.
"""

from typing import Dict, List, Optional
from uuid import uuid4

import pytest

import oss.src.core.secrets.services as services_module
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointData,
    LLMEndpointRoute,
    LLMModelFilter,
)
from oss.src.core.gateways.llms.interfaces import LLMEndpointsDAOInterface
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.llms.service import LLMGatewayService
from oss.src.core.gateways.llms.types import (
    LLMEndpointNotFoundError,
    LLMModelNotAllowedError,
    LLMNamedConnectionNotFoundError,
    LLMOrganizationConnectionSlugRequiredError,
)
from oss.src.core.gateways.policy.dtos import GatewayPlane
from oss.src.core.gateways.policy.resolution import SecretsResolver
from oss.src.core.gateways.types import LLMGatewayConnectionNotServedError
from oss.src.core.secrets.dtos import CreateSecretDTO, SecretResponseDTO
from oss.src.core.secrets.enums import (
    ORGANIZATION_GATEWAY_KINDS,
    ORGANIZATION_SECRET_KINDS,
    SecretAvailability,
    SecretKind,
    SecretOwnerKind,
)
from oss.src.core.secrets.services import VaultService
from oss.src.core.shared.dtos import Header
from oss.src.utils.env import env
from oss.tests.pytest.utils.organization_secrets import (
    InMemorySecretsDAO,
    install_cache_engine,
    make_auth_scope,
    org_secret_payload,
)
from oss.tests.pytest.utils.principals import bearer_request_access


class _Endpoints(LLMEndpointsDAOInterface):
    """Project endpoint rows by slug."""

    def __init__(self):
        self.rows: Dict[str, LLMEndpoint] = {}
        self.calls: List[str] = []

    async def fetch_endpoint_by_slug(self, *, project_id, slug):
        self.calls.append("fetch_endpoint_by_slug")
        return self.rows.get(slug)

    async def create_endpoint(self, **kwargs):
        self.calls.append("create_endpoint")

    async def fetch_endpoint(self, **kwargs):
        return None

    async def edit_endpoint(self, **kwargs):
        self.calls.append("edit_endpoint")

    async def delete_endpoint(self, **kwargs):
        return True

    async def query_endpoints(self, **kwargs):
        return []


class _SpyResolver(SecretsResolver):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.resolve_calls = 0

    async def resolve(self, **kwargs):
        self.resolve_calls += 1
        return await super().resolve(**kwargs)


class _AllowLimits:
    async def allows_selected_projects(self, *, organization_id):
        return True


@pytest.fixture
def world(monkeypatch):
    engine = install_cache_engine(monkeypatch)

    async def no_publish(**kwargs):
        return None

    monkeypatch.setattr(services_module, "_safe_publish", no_publish)
    organization_id = uuid4()
    sales, marketing = uuid4(), uuid4()
    secrets_dao = InMemorySecretsDAO(
        projects={sales: organization_id, marketing: organization_id}
    )
    vault = VaultService(secrets_dao, project_limits=_AllowLimits())
    endpoints = _Endpoints()
    resolver = _SpyResolver(vault_service=vault, plane=GatewayPlane.LLM)
    service = LLMGatewayService(
        llm_endpoints_dao=endpoints,
        policy=None,  # not reached by the resolve paths under test
        resolver=resolver,
        upstream_registry=LLMUpstreamRegistry(adapters={}),
    )
    return dict(
        engine=engine,
        secrets_dao=secrets_dao,
        vault=vault,
        endpoints=endpoints,
        resolver=resolver,
        service=service,
        organization_id=organization_id,
        sales=sales,
        marketing=marketing,
        scope=make_auth_scope(organization_id=organization_id, project_id=sales),
    )


async def _company(
    world, *, kind="custom_provider", family="azure", slug="azure-company"
):
    return await world["vault"].create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(
            org_secret_payload(
                kind=kind, family=family, slug=slug, key="sk-company-0123456789"
            )
        ),
        user_id=uuid4(),
    )


def _endpoint_row(slug: str) -> LLMEndpoint:
    return LLMEndpoint(
        id=uuid4(),
        slug=slug,
        header=Header(name=slug),
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.CUSTOM,
        secret_id=uuid4(),
        data=LLMEndpointData(
            route=LLMEndpointRoute(base_url="https://project.example/v1"),
            models=LLMModelFilter(allowlist=["gpt-4o-mini"]),
        ),
    )


async def _resolve(world, **kwargs):
    return await world["service"].resolve_agent_connection(
        scope=kwargs.get("scope", world["scope"]),
        model="gpt-4o-mini",
        provider_key=kwargs.get("provider_key"),
        connection_slug=kwargs.get("slug"),
        connection_namespace=kwargs.get("namespace"),
        connection_scope=kwargs.get("connection_scope", SecretOwnerKind.PROJECT),
    )


ORG = SecretOwnerKind.ORGANIZATION


async def test_a_named_company_azure_resolves_in_the_organization_namespace(world):
    await _company(world)
    resolved = await _resolve(world, slug="azure-company", connection_scope=ORG)
    assert resolved.namespace == GatewayEndpointNamespace.ORGANIZATION
    assert resolved.name == "azure-company"
    assert resolved.deployment_kind == LLMDeploymentKind.AZURE
    assert resolved.custom_provider is True
    assert "create_endpoint" not in world["endpoints"].calls
    assert "edit_endpoint" not in world["endpoints"].calls


async def test_a_named_company_key_resolves_like_a_standard_endpoint(world):
    company = await _company(
        world, kind="provider_key", family="openai", slug="openai-company"
    )
    resolved = await _resolve(world, slug="openai-company", connection_scope=ORG)
    assert resolved.namespace == GatewayEndpointNamespace.ORGANIZATION
    assert resolved.provider_key == "openai"
    assert resolved.custom_provider is False
    target = await world["service"]._resolve_target(
        scope=world["scope"],
        namespace=GatewayEndpointNamespace.ORGANIZATION,
        name="openai-company",
    )
    assert target.secret_id == company.id
    assert target.secret_owner_kind == ORG


async def test_an_organization_slug_without_scope_is_never_used(world):
    """No name joins the two scopes: a project slug miss stays a miss."""
    await _company(world)
    with pytest.raises(LLMEndpointNotFoundError):
        await _resolve(world, slug="azure-company")
    with pytest.raises(LLMEndpointNotFoundError):
        await world["service"]._resolve_target(
            scope=world["scope"],
            namespace=GatewayEndpointNamespace.CUSTOM,
            name="azure-company",
        )


async def test_a_project_row_with_the_slug_never_stands_in_for_the_organization(world):
    world["endpoints"].rows["azure-company"] = _endpoint_row("azure-company")
    with pytest.raises(LLMNamedConnectionNotFoundError) as excinfo:
        await _resolve(world, slug="azure-company", connection_scope=ORG)
    assert (excinfo.value.scope, excinfo.value.slug) == (ORG, "azure-company")
    # And the project slug keeps naming the project row.
    target = await world["service"]._resolve_slug_target(
        scope=world["scope"], slug="azure-company"
    )
    assert target.endpoint_id is not None
    assert target.secret_owner_kind == SecretOwnerKind.PROJECT


async def test_a_missing_or_unavailable_organization_connection_is_typed(world):
    company = await _company(world)
    await world["vault"].set_organization_secret_availability(
        organization_id=world["organization_id"],
        secret_id=company.id,
        availability=SecretAvailability.SELECTED_PROJECTS,
        project_ids=[world["marketing"]],
        user_id=uuid4(),
    )
    for slug in ("azure-company", "no-such-company"):
        with pytest.raises(LLMNamedConnectionNotFoundError):
            await _resolve(world, slug=slug, connection_scope=ORG)
    marketing = make_auth_scope(
        organization_id=world["organization_id"], project_id=world["marketing"]
    )
    resolved = await _resolve(
        world, slug="azure-company", connection_scope=ORG, scope=marketing
    )
    assert resolved.namespace == GatewayEndpointNamespace.ORGANIZATION


@pytest.mark.parametrize(
    "kwargs",
    [
        {"connection_scope": ORG},  # no slug
        {"slug": "azure-company", "namespace": GatewayEndpointNamespace.ORGANIZATION},
        {
            "slug": "azure-company",
            "connection_scope": ORG,
            "namespace": GatewayEndpointNamespace.CUSTOM,
        },
    ],
)
async def test_an_incomplete_organization_reference_is_refused(world, kwargs):
    await _company(world)
    with pytest.raises(LLMOrganizationConnectionSlugRequiredError):
        await _resolve(world, provider_key="openai", **kwargs)


@pytest.mark.parametrize("family", ["bedrock", "sagemaker"])
async def test_organization_bedrock_and_sagemaker_rows_are_not_served(world, family):
    # Rows the write rule would refuse, put in storage directly (as SQL would).
    dto = CreateSecretDTO.model_validate(
        org_secret_payload(kind="custom_provider", family=family, slug="cloud-company")
    )
    await world["secrets_dao"].create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=dto,
        availability=SecretAvailability.ALL_PROJECTS,
        project_ids=[],
        user_id=uuid4(),
    )
    with pytest.raises(LLMGatewayConnectionNotServedError):
        await _resolve(world, slug="cloud-company", connection_scope=ORG)
    with pytest.raises(LLMGatewayConnectionNotServedError):
        await world["service"]._resolve_target(
            scope=world["scope"],
            namespace=GatewayEndpointNamespace.ORGANIZATION,
            name="cloud-company",
        )


@pytest.mark.parametrize("with_key", [False, True])
async def test_provider_family_slug_resolves_with_no_secret_read(world, with_key):
    if with_key:
        await world["vault"].create_secret(
            project_id=world["sales"],
            create_secret_dto=CreateSecretDTO.model_validate(
                org_secret_payload(slug="mine")
            ),
        )
    world["engine"].commands.clear()
    world["secrets_dao"].calls.clear()
    world["endpoints"].calls.clear()
    resolved = await _resolve(world, slug="openai")
    assert resolved.namespace == GatewayEndpointNamespace.STANDARD
    assert world["endpoints"].calls == ["fetch_endpoint_by_slug"]
    assert world["engine"].commands == []
    assert world["secrets_dao"].calls == []


async def test_relay_uses_the_carried_organization_secret(world):
    company = await _company(world, family="custom")
    target = await world["service"]._resolve_target(
        scope=world["scope"],
        namespace=GatewayEndpointNamespace.ORGANIZATION,
        name="azure-company",
    )
    assert target.resolved_secret.secret.id == company.id
    assert target.resolved_secret.owner.kind == ORG
    assert target.secret_owner_kind == ORG
    assert target.endpoint_id is None
    ref = target.secret_ref()
    assert ref.owner_kind == ORG
    # The relay takes `target.resolved_secret`; the resolver is never asked.
    assert world["resolver"].resolve_calls == 0


async def _organization_target(world, slug):
    return await world["service"]._resolve_target(
        scope=world["scope"],
        namespace=GatewayEndpointNamespace.ORGANIZATION,
        name=slug,
    )


async def test_an_organization_key_leaves_the_model_to_the_provider(world):
    """Like a project key: a model the catalogue does not list (a dated id) is relayed."""
    await _company(world, kind="provider_key", family="anthropic", slug="claude-co")
    target = await _organization_target(world, "claude-co")
    context = LLMCallContext(model="claude-haiku-4-5-20251001")
    world["service"]._check_allowlist(target=target, context=context, payload={})
    assert target.upstream_model(context.model) == context.model


async def test_an_organization_custom_provider_sends_the_bare_model_upstream(world):
    """Like a project custom provider: the allowlist holds both spellings, and only the
    bare model slug reaches the upstream."""
    await _company(world, family="custom", slug="custom-co")
    target = await _organization_target(world, "custom-co")
    qualified = next(model for model in target.models.allowlist if "/" in model)
    world["service"]._check_allowlist(
        target=target, context=LLMCallContext(model=qualified), payload={}
    )
    assert target.upstream_model(qualified) == "gpt-4o-mini"
    with pytest.raises(LLMModelNotAllowedError):
        world["service"]._check_allowlist(
            target=target, context=LLMCallContext(model="gpt-5"), payload={}
        )


async def test_an_organization_target_reads_the_entry_once_per_request(world):
    company = await _company(
        world, kind="provider_key", family="openai", slug="openai-company"
    )
    service = world["service"]
    with bearer_request_access(uuid4()):
        await world["vault"].list_secrets(project_id=world["sales"])  # warm
    world["engine"].commands.clear()
    with bearer_request_access(uuid4()):
        await _resolve(world, slug="openai-company", connection_scope=ORG)
        target = await service._resolve_target(
            scope=world["scope"],
            namespace=GatewayEndpointNamespace.ORGANIZATION,
            name="openai-company",
        )
    assert target.resolved_secret.secret.id == company.id
    assert world["engine"].commands == ["GET"]


# --- the one-pass resolve gives today's answers ------------------------------------ #


async def _old_two_step(service: LLMGatewayService, *, scope, slug):
    """The pre-M5 code, kept here verbatim in behavior: namespace first (custom row,
    builtin, standard connection, else custom), then the target in that namespace."""
    custom = await service.llm_endpoints_dao.fetch_endpoint_by_slug(
        project_id=scope.project_id, slug=slug
    )
    from oss.src.core.gateways.llms.catalog import builtin_llm_endpoint

    if custom is not None:
        namespace = GatewayEndpointNamespace.CUSTOM
    elif builtin_llm_endpoint(provider_key=slug) is not None:
        namespace = GatewayEndpointNamespace.BUILTIN
    elif await service._standard_connection(scope=scope, name=slug) is not None:
        namespace = GatewayEndpointNamespace.STANDARD
    else:
        namespace = GatewayEndpointNamespace.CUSTOM
    return await service._resolve_target(scope=scope, namespace=namespace, name=slug)


def _shape(target):
    return (
        target.namespace,
        target.name,
        target.provider_key,
        target.deployment_kind,
        target.secret_id,
        target.endpoint_id,
    )


@pytest.mark.parametrize(
    "slug",
    [
        "project-custom",
        "mock",
        "openai",
        "anthropic",
        "mine-openai",
        "unknown-slug",
        "starter-credits",
    ],
)
@pytest.mark.parametrize("with_key", [False, True])
async def test_resolve_slug_target_matches_the_old_two_step_code(
    world, monkeypatch, slug, with_key
):
    monkeypatch.setattr(env.mock_gateways, "enabled", True)
    world["endpoints"].rows["project-custom"] = _endpoint_row("project-custom")
    if with_key:
        await world["vault"].create_secret(
            project_id=world["sales"],
            create_secret_dto=CreateSecretDTO.model_validate(
                org_secret_payload(slug="mine-openai")
            ),
        )
    service, scope = world["service"], world["scope"]

    async def outcome(call):
        try:
            return _shape(await call())
        except LLMEndpointNotFoundError as error:
            return ("not-found", error.namespace, error.name)

    old = await outcome(lambda: _old_two_step(service, scope=scope, slug=slug))
    new = await outcome(lambda: service._resolve_slug_target(scope=scope, slug=slug))
    assert new == old


def test_shareable_kinds_hold_the_custom_provider():
    assert SecretKind.CUSTOM_PROVIDER in ORGANIZATION_SECRET_KINDS


def _unused(_: Optional[SecretResponseDTO]):
    return None


async def test_an_organization_subscription_login_is_never_a_gateway_target(world):
    """An organization subscription login runs on the runner, never through the LLM
    gateway; the gateway answers the typed not-found error for its slug."""
    await world["vault"].create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {"name": "Company ChatGPT"},
                "secret": {
                    "kind": "subscription_provider",
                    "data": {"provider": "chatgpt"},
                },
            }
        ),
        user_id=uuid4(),
    )
    with pytest.raises(LLMNamedConnectionNotFoundError):
        await _resolve(world, slug="chatgpt", connection_scope=ORG)


def test_the_gateway_kinds_leave_out_the_subscription_login():
    assert SecretKind.SUBSCRIPTION_PROVIDER in ORGANIZATION_SECRET_KINDS
    assert SecretKind.SUBSCRIPTION_PROVIDER not in ORGANIZATION_GATEWAY_KINDS
