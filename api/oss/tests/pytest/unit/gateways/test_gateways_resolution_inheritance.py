"""Gateway resolution over the effective credential set, per plane (M5, Task 9).

A real `VaultService` over the in-memory owner-based DAO and the recording cache engine.
"""

import re
from pathlib import Path
from uuid import uuid4

import pytest

import oss.src.core.secrets.services as services_module
from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    GatewayPlane,
    ProviderKeyRef,
    SecretMode,
)
from oss.src.core.gateways.policy.resolution import SecretsResolver
from oss.src.core.gateways.policy.types import SecretNotFoundError
from oss.src.core.secrets.dtos import CreateSecretDTO
from oss.src.core.secrets.enums import SecretAvailability, SecretOwnerKind
from oss.src.core.secrets.services import VaultService
from oss.src.utils.env import env
from oss.tests.pytest.utils.organization_secrets import (
    InMemorySecretsDAO,
    install_cache_engine,
    make_auth_scope,
    org_secret_payload,
)

MODE = SecretMode.PROJECT_ONLY


class _AllowLimits:
    async def allows_selected_projects(self, *, organization_id):
        return True


@pytest.fixture
def world(monkeypatch):
    install_cache_engine(monkeypatch)

    async def no_publish(**kwargs):
        return None

    monkeypatch.setattr(services_module, "_safe_publish", no_publish)
    organization_id = uuid4()
    sales, marketing = uuid4(), uuid4()
    dao = InMemorySecretsDAO(
        projects={sales: organization_id, marketing: organization_id}
    )
    vault = VaultService(dao, project_limits=_AllowLimits())
    return dict(
        dao=dao,
        vault=vault,
        llm=SecretsResolver(vault_service=vault, plane=GatewayPlane.LLM),
        mcp=SecretsResolver(vault_service=vault, plane=GatewayPlane.MCP),
        organization_id=organization_id,
        sales=sales,
        marketing=marketing,
        sales_scope=make_auth_scope(organization_id=organization_id, project_id=sales),
        marketing_scope=make_auth_scope(
            organization_id=organization_id, project_id=marketing
        ),
    )


async def _company(
    world, *, slug="openai-company", family="openai", key="sk-company-0123456789"
):
    return await world["vault"].create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(
            org_secret_payload(slug=slug, family=family, key=key)
        ),
        user_id=uuid4(),
    )


async def _project_key(
    world, project, *, slug, family="openai", key="sk-project-0123456789"
):
    return await world["vault"].create_secret(
        project_id=project,
        create_secret_dto=CreateSecretDTO.model_validate(
            org_secret_payload(slug=slug, family=family, key=key)
        ),
    )


async def test_new_project_sees_the_company_key(world):
    await _company(world)
    new_project = uuid4()
    world["dao"].projects[new_project] = world["organization_id"]
    scope = make_auth_scope(
        organization_id=world["organization_id"], project_id=new_project
    )
    assert "openai" in await world["llm"].available_provider_keys(scope=scope)
    resolved = await world["llm"].resolve(
        scope=scope, ref=ProviderKeyRef(provider_key="openai"), mode=MODE
    )
    assert resolved.owner.kind == SecretOwnerKind.ORGANIZATION
    assert resolved.secret.data.provider.key == "sk-company-0123456789"


async def test_slug_resolves_project_then_organization(world):
    company = await _company(world)
    override = await _project_key(world, world["sales"], slug="openai-company")
    sales = await world["llm"].provider_connection_by_slug(
        scope=world["sales_scope"], slug="openai-company"
    )
    marketing = await world["llm"].provider_connection_by_slug(
        scope=world["marketing_scope"], slug="openai-company"
    )
    assert (sales.secret_id, sales.owner_kind) == (override.id, SecretOwnerKind.PROJECT)
    assert (marketing.secret_id, marketing.owner_kind) == (
        company.id,
        SecretOwnerKind.ORGANIZATION,
    )


async def test_named_connection_removed_does_not_fall_back(world):
    await _company(world, slug="openai-other")
    named = await _project_key(world, world["sales"], slug="openai-sales")
    await world["vault"].delete_secret(secret_id=named.id, project_id=world["sales"])
    assert (
        await world["llm"].provider_connection_by_slug(
            scope=world["sales_scope"], slug="openai-sales"
        )
        is None
    )
    with pytest.raises(SecretNotFoundError):
        await world["llm"].resolve(
            scope=world["sales_scope"],
            ref=BoundSecretRef(secret_id=named.id),
            mode=MODE,
        )


async def test_default_prefers_the_project_key(world):
    await _company(world)
    own = await _project_key(world, world["sales"], slug="mine")
    resolved = await world["llm"].resolve(
        scope=world["sales_scope"], ref=ProviderKeyRef(provider_key="openai"), mode=MODE
    )
    assert resolved.secret.id == own.id
    assert resolved.owner.kind == SecretOwnerKind.PROJECT


async def test_resolved_secret_names_the_real_owner(world):
    company = await _company(world)
    resolved = await world["llm"].resolve(
        scope=world["marketing_scope"],
        ref=BoundSecretRef(
            secret_id=company.id, owner_kind=SecretOwnerKind.ORGANIZATION
        ),
        mode=MODE,
    )
    assert resolved.owner.kind == SecretOwnerKind.ORGANIZATION
    assert resolved.owner.id == world["organization_id"]


async def test_pinned_reference_never_substitutes(world):
    company = await _company(world)
    await _project_key(world, world["sales"], slug="mine")  # another key, never used
    ref = BoundSecretRef(secret_id=company.id, owner_kind=SecretOwnerKind.ORGANIZATION)

    # Limited away from Sales.
    await world["vault"].set_organization_secret_availability(
        organization_id=world["organization_id"],
        secret_id=company.id,
        availability=SecretAvailability.SELECTED_PROJECTS,
        project_ids=[world["marketing"]],
        user_id=uuid4(),
    )
    with pytest.raises(SecretNotFoundError) as excinfo:
        await world["llm"].resolve(scope=world["sales_scope"], ref=ref, mode=MODE)
    assert excinfo.value.missing == SecretOwnerKind.ORGANIZATION

    # Deleted.
    await world["vault"].delete_organization_secret(
        organization_id=world["organization_id"], secret_id=company.id
    )
    with pytest.raises(SecretNotFoundError):
        await world["llm"].resolve(scope=world["marketing_scope"], ref=ref, mode=MODE)


async def test_project_bound_reference_never_reads_organization_rows(world):
    company = await _company(world)
    with pytest.raises(SecretNotFoundError) as excinfo:
        await world["llm"].resolve(
            scope=world["sales_scope"],
            ref=BoundSecretRef(secret_id=company.id),  # owner_kind PROJECT
            mode=MODE,
        )
    assert excinfo.value.missing == SecretOwnerKind.PROJECT


async def test_mismatched_request_organization_inherits_nothing(world):
    await _company(world)
    scope = make_auth_scope(organization_id=uuid4(), project_id=world["sales"])
    assert await world["llm"].available_provider_keys(scope=scope) == set()


async def test_mcp_never_resolves_organization_rows(world, monkeypatch):
    monkeypatch.setattr(env.mock_gateways, "enabled", True)
    company = await _company(world, slug="mock-company", family="mock")
    mcp, scope = world["mcp"], world["sales_scope"]
    assert "mock" not in await mcp.available_provider_keys(scope=scope)
    assert (
        await mcp.provider_connection_by_slug(scope=scope, slug="mock-company") is None
    )
    assert not await mcp.has_connection(scope=scope, slug="mock-company")
    with pytest.raises(SecretNotFoundError):
        await mcp.resolve(
            scope=scope, ref=ProviderKeyRef(provider_key="mock"), mode=MODE
        )
    calls = list(world["dao"].calls)
    with pytest.raises(SecretNotFoundError) as excinfo:
        await mcp.resolve(
            scope=scope,
            ref=BoundSecretRef(
                secret_id=company.id, owner_kind=SecretOwnerKind.ORGANIZATION
            ),
            mode=MODE,
        )
    assert excinfo.value.missing == SecretOwnerKind.ORGANIZATION
    assert world["dao"].calls == calls  # refused without a read
    # The LLM plane does see it.
    assert "mock" in await world["llm"].available_provider_keys(scope=scope)


async def test_mcp_endpoint_list_ignores_organization_keys(world, monkeypatch):
    from oss.tests.pytest.unit.gateways.test_gateways_mcp_service import _service

    monkeypatch.setattr(env.mock_gateways, "enabled", True)
    await _company(world, slug="mock-company", family="mock")
    service = _service(resolver=world["mcp"])
    endpoints = await service.list_endpoints(scope=world["sales_scope"])

    # Only a project key of the family adds the standard mock endpoint; the organization
    # key above added nothing.
    await _project_key(world, world["sales"], slug="mock-mine", family="mock")
    with_key = await service.list_endpoints(scope=world["sales_scope"])
    assert len(with_key) == len(endpoints) + 1


def test_composition_roots_give_each_service_its_plane():
    source = (
        Path(__file__).resolve().parents[5] / "entrypoints" / "routers.py"
    ).read_text()
    assert re.search(
        r"llm_secrets_resolver = SecretsResolver\(\s*vault_service=vault_service,\s*plane=GatewayPlane\.LLM,",
        source,
    )
    assert re.search(
        r"mcp_secrets_resolver = SecretsResolver\(\s*vault_service=vault_service,\s*plane=GatewayPlane\.MCP,",
        source,
    )
    llm_block = source[source.index("llm_gateway_service = LLMGatewayService(") :]
    assert "resolver=llm_secrets_resolver" in llm_block[: llm_block.index("\n)\n")]
    mcp_block = source[source.index("mcp_gateway_service = MCPGatewayService(") :]
    assert (
        "resolver=mcp_secrets_resolver"
        in mcp_block[: mcp_block.index("upstream_registry")]
    )
    policy_block = source[
        source.index("gateway_policy_service = GatewayPolicyService(") :
    ]
    assert (
        "resolver=mcp_secrets_resolver" in policy_block[: policy_block.index("\n)\n")]
    )
    # No other resolver is built anywhere in the composition roots.
    for root in ("worker_queues.py", "worker_streams.py"):
        path = Path(__file__).resolve().parents[5] / "entrypoints" / root
        assert "SecretsResolver(" not in path.read_text()
