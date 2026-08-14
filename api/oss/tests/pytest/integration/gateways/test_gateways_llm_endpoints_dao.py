"""LLMEndpointsDAO against real Postgres (entities.md §7, WP1 exit condition).

Needs a live deployment_kind — write, do not run without one (`api/AGENTS.md`'s
test-layer rule).
"""

import pytest
from sqlalchemy import text

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpointCreate,
    LLMEndpointData,
    LLMEndpointEdit,
    LLMEndpointQuery,
    LLMEndpointRoute,
    LLMEndpointSettings,
    LLMModelFilter,
)
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.dbs.postgres.gateways.llms.dao import LLMEndpointsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


def _create_dto(*, slug: str) -> LLMEndpointCreate:
    return LLMEndpointCreate(
        slug=slug,
        name="Acme Azure",
        provider_key="azure",
        deployment_kind=LLMDeploymentKind.AZURE,
        data=LLMEndpointData(
            route=LLMEndpointRoute(base_url="https://acme.openai.azure.com"),
            models=LLMModelFilter(allowlist=["gpt-4o"]),
            settings=LLMEndpointSettings(max_output_tokens=4096),
        ),
    )


async def test_create_then_fetch_round_trips_field_for_field(seeded_project):
    dao = LLMEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]
    secret_id = seeded_project["secret_id"]

    create = _create_dto(slug="acme-azure")
    create.secret_id = secret_id

    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=create,
    )
    assert created is not None
    assert created.namespace == GatewayEndpointNamespace.CUSTOM

    fetched = await dao.fetch_endpoint(
        project_id=project_id,
        #
        endpoint_id=created.id,
    )
    assert fetched is not None
    assert fetched.slug == create.slug
    assert fetched.provider_key == create.provider_key
    assert fetched.deployment_kind == create.deployment_kind
    assert fetched.secret_id == secret_id
    assert fetched.data.route.base_url == create.data.route.base_url
    assert fetched.data.models.allowlist == create.data.models.allowlist

    by_slug = await dao.fetch_endpoint_by_slug(
        project_id=project_id,
        #
        slug=create.slug,
    )
    assert by_slug is not None
    assert by_slug.id == created.id


async def test_duplicate_slug_raises_entity_creation_conflict(seeded_project):
    dao = LLMEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-dup"),
    )

    with pytest.raises(EntityCreationConflict) as excinfo:
        await dao.create_endpoint(
            project_id=project_id,
            user_id=user_id,
            #
            endpoint=_create_dto(slug="acme-dup"),
        )
    assert excinfo.value.conflict == {"slug": "acme-dup"}


async def test_edit_endpoint_replaces_data_and_flags_wholesale(seeded_project):
    dao = LLMEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-edit"),
    )
    assert created.data.route.extras is None
    assert created.data.settings.max_output_tokens == 4096

    edit = LLMEndpointEdit(
        id=created.id,
        data=LLMEndpointData(
            route=LLMEndpointRoute(base_url="https://new.openai.azure.com"),
            models=LLMModelFilter(allowlist=["gpt-4o-mini"]),
            # the original's `models` allowlist is gone unless
            # repeated here — this is a PUT, not a PATCH.
        ),
    )

    edited = await dao.edit_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=edit,
    )
    assert edited is not None
    assert edited.data.route.base_url == "https://new.openai.azure.com"
    assert edited.data.models.allowlist == ["gpt-4o-mini"]
    assert edited.data.settings.max_output_tokens is None
    assert edited.updated_by_id == user_id
    assert edited.updated_at is not None

    refetched = await dao.fetch_endpoint(
        project_id=project_id,
        #
        endpoint_id=created.id,
    )
    assert refetched.data.models.allowlist == ["gpt-4o-mini"]


async def test_delete_endpoint_is_idempotent(seeded_project):
    dao = LLMEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-delete"),
    )

    first = await dao.delete_endpoint(
        project_id=project_id,
        #
        endpoint_id=created.id,
    )
    assert first is True

    second = await dao.delete_endpoint(
        project_id=project_id,
        #
        endpoint_id=created.id,
    )
    assert second is False

    assert (
        await dao.fetch_endpoint(project_id=project_id, endpoint_id=created.id) is None
    )


async def test_query_endpoints_filters_by_provider_and_deployment(seeded_project):
    dao = LLMEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]

    azure = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=_create_dto(slug="acme-query-azure"),
    )
    direct = LLMEndpointCreate(
        slug="acme-query-direct",
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.DIRECT,
        data=LLMEndpointData(models=LLMModelFilter(allowlist=["gpt-4o"])),
    )
    openai = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=direct,
    )

    by_provider = await dao.query_endpoints(
        project_id=project_id,
        #
        endpoint=LLMEndpointQuery(provider_key="azure"),
    )
    assert {e.id for e in by_provider} == {azure.id}

    by_deployment = await dao.query_endpoints(
        project_id=project_id,
        #
        endpoint=LLMEndpointQuery(deployment_kind=LLMDeploymentKind.DIRECT),
    )
    assert {e.id for e in by_deployment} == {openai.id}

    by_slug = await dao.query_endpoints(
        project_id=project_id,
        #
        endpoint=LLMEndpointQuery(slug="acme-query-azure"),
    )
    assert {e.id for e in by_slug} == {azure.id}


async def test_deleting_secret_sets_endpoint_secret_id_null(seeded_project):
    """D18/§2.1: a dead secret must not silently delete configuration."""
    dao = LLMEndpointsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    user_id = seeded_project["user_id"]
    secret_id = seeded_project["secret_id"]

    create = _create_dto(slug="acme-fk-set-null")
    create.secret_id = secret_id
    created = await dao.create_endpoint(
        project_id=project_id,
        user_id=user_id,
        #
        endpoint=create,
    )
    assert created.secret_id == secret_id

    engine = get_transactions_engine()
    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM secrets WHERE id = :id"), {"id": secret_id}
        )
        await session.commit()

    survivor = await dao.fetch_endpoint(
        project_id=project_id,
        #
        endpoint_id=created.id,
    )
    assert survivor is not None
    assert survivor.secret_id is None
