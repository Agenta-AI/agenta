"""Inherited custom providers and the one-pass slug resolve (M5, Task 10).

The LLM gateway service with a real LLM-plane `SecretsResolver` over a real
`VaultService` (in-memory owner-based DAO, recording cache engine), and an in-memory
endpoints DAO whose custom target lookup answers like the Postgres one.
"""

from typing import Dict, List, Optional
from uuid import uuid4

import pytest

import oss.src.core.secrets.services as services_module
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointData,
    LLMEndpointRoute,
    LLMModelFilter,
)
from oss.src.core.gateways.llms.interfaces import (
    CustomTargetLookup,
    LLMEndpointsDAOInterface,
)
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.llms.service import LLMGatewayService
from oss.src.core.gateways.llms.types import LLMEndpointNotFoundError
from oss.src.core.gateways.policy.dtos import GatewayPlane, SecretMode
from oss.src.core.gateways.policy.resolution import SecretsResolver
from oss.src.core.gateways.types import LLMGatewayConnectionNotServedError
from oss.src.core.secrets.dtos import CreateSecretDTO, SecretResponseDTO
from oss.src.core.secrets.enums import (
    INHERITABLE_KINDS,
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
    """Endpoint rows by slug, plus the inherited lookup over the secrets DAO."""

    def __init__(self, secrets_dao: InMemorySecretsDAO):
        self.rows: Dict[str, LLMEndpoint] = {}
        self.secrets_dao = secrets_dao
        self.calls: List[str] = []

    async def fetch_custom_target_by_slug(self, *, project_id, organization_id, slug):
        self.calls.append("fetch_custom_target_by_slug")
        row = self.rows.get(slug)
        if row is not None:
            return CustomTargetLookup(endpoint=row)
        dao = self.secrets_dao
        if dao.projects.get(project_id) != organization_id:
            return CustomTargetLookup()
        if any(
            r.slug == slug
            for r in dao.records.values()
            if r.owner
            and r.owner.kind == SecretOwnerKind.PROJECT
            and r.owner.id == project_id
        ):
            return CustomTargetLookup()  # shadowed by a project secret
        for r in dao._org_rows(organization_id):
            if (
                r.slug == slug
                and r.kind == SecretKind.CUSTOM_PROVIDER
                and dao._available(r, project_id)
            ):
                return CustomTargetLookup(inherited=r)
        return CustomTargetLookup()

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
    endpoints = _Endpoints(secrets_dao)
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
        scope=world["scope"],
        model="gpt-4o-mini",
        provider_key=kwargs.get("provider_key"),
        connection_slug=kwargs.get("slug"),
    )


async def test_company_azure_resolves_by_slug_without_an_endpoint_row(world):
    await _company(world)
    resolved = await _resolve(world, slug="azure-company")
    assert resolved.namespace == GatewayEndpointNamespace.CUSTOM
    assert resolved.name == "azure-company"
    assert resolved.deployment_kind == LLMDeploymentKind.AZURE
    assert "create_endpoint" not in world["endpoints"].calls
    assert "edit_endpoint" not in world["endpoints"].calls


async def test_project_endpoint_row_with_the_slug_wins(world):
    await _company(world)
    world["endpoints"].rows["azure-company"] = _endpoint_row("azure-company")
    target = await world["service"]._resolve_slug_target(
        scope=world["scope"], slug="azure-company"
    )
    assert target.endpoint_id is not None
    assert target.secret_owner_kind == SecretOwnerKind.PROJECT
    assert target.resolved_secret is None


@pytest.mark.parametrize("family", ["bedrock", "sagemaker"])
async def test_inherited_bedrock_and_sagemaker_rows_are_not_served(world, family):
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
        await _resolve(world, slug="cloud-company")
    with pytest.raises(LLMGatewayConnectionNotServedError):
        await world["service"]._resolve_target(
            scope=world["scope"],
            namespace=GatewayEndpointNamespace.CUSTOM,
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
    assert world["endpoints"].calls == ["fetch_custom_target_by_slug"]
    assert world["engine"].commands == []
    assert world["secrets_dao"].calls == []


async def test_relay_uses_the_carried_inherited_secret(world, monkeypatch):
    company = await _company(world, family="custom")
    target = await world["service"]._resolve_target(
        scope=world["scope"],
        namespace=GatewayEndpointNamespace.CUSTOM,
        name="azure-company",
    )
    assert target.resolved_secret.secret.id == company.id
    assert target.resolved_secret.owner.kind == SecretOwnerKind.ORGANIZATION
    assert target.secret_owner_kind == SecretOwnerKind.ORGANIZATION
    assert target.endpoint_id is None
    ref = target.secret_ref()
    assert ref.owner_kind == SecretOwnerKind.ORGANIZATION
    # The relay takes `target.resolved_secret`; the resolver is never asked.
    assert world["resolver"].resolve_calls == 0


async def test_an_inherited_custom_provider_shadowed_by_a_project_secret_is_not_used(
    world,
):
    await _company(world, family="custom")
    await world["vault"].create_secret(
        project_id=world["sales"],
        create_secret_dto=CreateSecretDTO.model_validate(
            org_secret_payload(
                kind="custom_provider", family="custom", slug="azure-company"
            )
        ),
    )
    lookup = await world["endpoints"].fetch_custom_target_by_slug(
        project_id=world["sales"],
        organization_id=world["organization_id"],
        slug="azure-company",
    )
    assert lookup.inherited is None


async def test_relay_with_an_organization_slug_reads_once(world):
    company = await _company(
        world, kind="provider_key", family="openai", slug="openai-company"
    )
    service = world["service"]
    with bearer_request_access(uuid4()):
        await world["vault"].list_secrets(project_id=world["sales"])  # warm
    world["engine"].commands.clear()
    with bearer_request_access(uuid4()):
        target = await service._resolve_target(
            scope=world["scope"],
            namespace=GatewayEndpointNamespace.STANDARD,
            name="openai-company",
        )
        secret = await world["resolver"].resolve(
            scope=world["scope"], ref=target.secret_ref(), mode=SecretMode.PROJECT_ONLY
        )
    assert secret.secret.id == company.id
    assert secret.owner.kind == SecretOwnerKind.ORGANIZATION
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


def test_inheritable_kinds_hold_the_custom_provider():
    assert SecretKind.CUSTOM_PROVIDER in INHERITABLE_KINDS


def _unused(_: Optional[SecretResponseDTO]):
    return None
