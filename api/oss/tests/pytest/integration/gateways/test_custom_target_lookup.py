"""`LLMEndpointsDAO.fetch_custom_target_by_slug`: one statement for every lookup shape
(M5, Task 10), on the deployment's Postgres."""

from uuid import uuid4

import pytest

import oss.src.core.secrets.services as services_module
from oss.src.core.gateways.llms.registrar import LLMEndpointRegistrar
from oss.src.core.secrets.context import set_data_encryption_key
from oss.src.core.secrets.dtos import CreateSecretDTO
from oss.src.core.secrets.enums import SecretAvailability, SecretOwnerKind
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.gateways.llms.dao import LLMEndpointsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    seed_organization,
)
from oss.tests.pytest.utils.organization_secrets import org_secret_payload
from oss.tests.pytest.utils.statements import count_statements


pytestmark = pytest.mark.integration


class _AllowLimits:
    async def allows_selected_projects(self, *, organization_id):
        return True


@pytest.fixture(autouse=True)
def _no_events(monkeypatch):
    async def no_publish(**kwargs):
        return None

    monkeypatch.setattr(services_module, "_safe_publish", no_publish)


@pytest.fixture
async def world():
    seeded = await seed_organization(
        members={"owner": "owner"}, projects_per_workspace=2
    )
    other = await seed_organization(members={"owner": "owner"})
    empty = await seed_organization(members={"owner": "owner"})
    endpoints = LLMEndpointsDAO(engine=get_transactions_engine())
    vault = VaultService(
        SecretsDAO(),
        llm_endpoint_registrar=LLMEndpointRegistrar(llm_endpoints_dao=endpoints),
        project_limits=_AllowLimits(),
    )
    yield dict(
        seeded=seeded, other=other, empty=empty, endpoints=endpoints, vault=vault
    )
    for org in (seeded, other, empty):
        await delete_seeded_organization(org)


def _custom(slug, *, family="custom"):
    return CreateSecretDTO.model_validate(
        org_secret_payload(
            kind="custom_provider", family=family, slug=slug, key="sk-0123456789-x"
        )
    )


async def _lookup(world, *, project_id, organization_id, slug):
    with set_data_encryption_key(data_encryption_key=env.agenta.crypt_key):
        with count_statements(get_transactions_engine()) as statements:
            lookup = await world["endpoints"].fetch_custom_target_by_slug(
                project_id=project_id, organization_id=organization_id, slug=slug
            )
    assert len(statements) == 1, statements
    return lookup


async def test_custom_lookup_is_one_statement_for_hit_miss_and_inherited(world):
    seeded, other, empty = world["seeded"], world["other"], world["empty"]
    sales, marketing = seeded.project_ids
    org = seeded.organization_id
    vault = world["vault"]

    project_row = await vault.create_secret(
        project_id=sales, create_secret_dto=_custom("project-custom")
    )
    company = await vault.create_organization_secret(
        organization_id=org,
        create_secret_dto=_custom("company-custom"),
        user_id=seeded.owner_id,
    )
    limited = await vault.create_organization_secret(
        organization_id=org,
        create_secret_dto=_custom("limited-custom"),
        user_id=seeded.owner_id,
        availability=SecretAvailability.SELECTED_PROJECTS,
        project_ids=[marketing],
    )
    await vault.create_organization_secret(
        organization_id=org,
        create_secret_dto=_custom("shadowed-custom"),
        user_id=seeded.owner_id,
    )
    await vault.create_secret(
        project_id=sales, create_secret_dto=_custom("shadowed-custom")
    )
    await vault.create_organization_secret(
        organization_id=other.organization_id,
        create_secret_dto=_custom("foreign-custom"),
        user_id=other.owner_id,
    )

    # A project endpoint row (written by the registrar).
    lookup = await _lookup(
        world, project_id=sales, organization_id=org, slug="project-custom"
    )
    assert lookup.endpoint is not None and lookup.endpoint.secret_id == project_row.id
    assert lookup.inherited is None

    # An inherited row.
    lookup = await _lookup(
        world, project_id=sales, organization_id=org, slug="company-custom"
    )
    assert lookup.endpoint is None
    assert lookup.inherited.id == company.id
    assert lookup.inherited.owner.kind == SecretOwnerKind.ORGANIZATION
    assert lookup.inherited.data.provider.key == "sk-0123456789-x"

    # Shadowed by a project secret with the slug: the project's endpoint row answers.
    lookup = await _lookup(
        world, project_id=sales, organization_id=org, slug="shadowed-custom"
    )
    assert lookup.inherited is None and lookup.endpoint is not None

    # Limited away from Sales, available to Marketing.
    assert (
        await _lookup(
            world, project_id=sales, organization_id=org, slug="limited-custom"
        )
    ).inherited is None
    assert (
        await _lookup(
            world, project_id=marketing, organization_id=org, slug="limited-custom"
        )
    ).inherited.id == limited.id

    # Another organization's row, and a request organization that differs.
    assert (
        await _lookup(
            world, project_id=sales, organization_id=org, slug="foreign-custom"
        )
    ).inherited is None
    assert (
        await _lookup(
            world,
            project_id=sales,
            organization_id=other.organization_id,
            slug="company-custom",
        )
    ).inherited is None

    # Unknown slugs, in an organization with credentials and in one without.
    lookup = await _lookup(world, project_id=sales, organization_id=org, slug="unknown")
    assert lookup.endpoint is None and lookup.inherited is None
    lookup = await _lookup(
        world,
        project_id=empty.project_ids[0],
        organization_id=empty.organization_id,
        slug="unknown",
    )
    assert lookup.endpoint is None and lookup.inherited is None

    # An unknown project.
    lookup = await _lookup(
        world, project_id=uuid4(), organization_id=org, slug="company-custom"
    )
    assert lookup.endpoint is None and lookup.inherited is None


async def test_tenancy_rule_unchanged(world):
    """An endpoint row may still not bind an organization secret."""
    from oss.src.core.gateways.llms.dtos import LLMEndpointCreate, LLMEndpointData
    from oss.src.core.gateways.policy.types import SecretInvalidError

    seeded = world["seeded"]
    company = await world["vault"].create_organization_secret(
        organization_id=seeded.organization_id,
        create_secret_dto=_custom("company-custom"),
        user_id=seeded.owner_id,
    )
    with pytest.raises(SecretInvalidError):
        await world["endpoints"].create_endpoint(
            project_id=seeded.project_ids[0],
            user_id=seeded.owner_id,
            endpoint=LLMEndpointCreate(
                slug="binds-company",
                provider_key="openai",
                deployment_kind="custom",
                secret_id=company.id,
                data=LLMEndpointData(),
            ),
        )
