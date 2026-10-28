"""`WorkflowsService.resolve_agent_artifact_id` on an `environment` reference, with the
real `EnvironmentsService` and `WorkflowsDAO` on the real database: an archived
environment and a deployed revision that is deleted, archived, in another project, or
of another artifact are unresolved; a live deployment resolves to its artifact.

Every test seeds its own organization; the organization delete in `finally` cascades to
every row written here.
"""

import json
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest

import oss.src.dbs.postgres.folders.dbes  # noqa: F401  (workflow_artifacts.folder_id)
import oss.src.models.db_models  # noqa: F401  (the ORM tables)
from oss.src.core.environments.service import EnvironmentsService
from oss.src.core.sessions.types import SessionReference
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.types import AgentReferenceUnresolved
from oss.src.dbs.postgres.environments.dbes import (
    EnvironmentArtifactDBE,
    EnvironmentRevisionDBE,
    EnvironmentVariantDBE,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.workflows.dao import WorkflowsDAO
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowRevisionDBE,
    WorkflowVariantDBE,
)
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    seed_organization,
)


pytestmark = pytest.mark.integration


@asynccontextmanager
async def seeded():
    org = await seed_organization(members={"alice": "editor"}, projects=2)
    try:
        yield org
    finally:
        await delete_seeded_organization(org)


def _service() -> WorkflowsService:
    engine = get_transactions_engine()
    environments = EnvironmentsService(
        environments_dao=GitDAO(
            engine=engine,
            ArtifactDBE=EnvironmentArtifactDBE,
            VariantDBE=EnvironmentVariantDBE,
            RevisionDBE=EnvironmentRevisionDBE,
        )
    )
    return WorkflowsService(
        workflows_dao=WorkflowsDAO(
            engine=engine,
            ArtifactDBE=WorkflowArtifactDBE,
            VariantDBE=WorkflowVariantDBE,
            RevisionDBE=WorkflowRevisionDBE,
        ),
        environments_service=environments,
    )


async def _agent(project_id: UUID) -> dict:
    ids = {"artifact": uuid4(), "variant": uuid4(), "revision": uuid4()}
    params = {"p": project_id, **ids, **{f"{k}_slug": v.hex for k, v in ids.items()}}
    await execute(
        "INSERT INTO workflow_artifacts (project_id, id, slug) VALUES (:p, :artifact, "
        ":artifact_slug)",
        params,
    )
    await execute(
        "INSERT INTO workflow_variants (project_id, artifact_id, id, slug) "
        "VALUES (:p, :artifact, :variant, :variant_slug)",
        params,
    )
    await execute(
        "INSERT INTO workflow_revisions (project_id, artifact_id, variant_id, id, "
        "slug, author, flags) VALUES (:p, :artifact, :variant, :revision, "
        ":revision_slug, :p, CAST('{\"is_agent\": true}' AS jsonb))",
        params,
    )
    return ids


async def _environment(project_id: UUID, deployed: dict) -> str:
    """An environment whose one revision deploys `deployed` (the agent's ids)."""

    artifact_id, variant_id, revision_id = uuid4(), uuid4(), uuid4()
    slug = f"env-{artifact_id.hex[:12]}"
    data = {
        "references": {
            "agent.revision": {
                "application": {"id": str(deployed["artifact"])},
                "application_variant": {"id": str(deployed["variant"])},
                "application_revision": {"id": str(deployed["revision"])},
            }
        }
    }
    params = {
        "p": project_id,
        "a": artifact_id,
        "v": variant_id,
        "r": revision_id,
        "s": slug,
        "vs": f"{slug}.default",
        "rs": revision_id.hex,
        "d": json.dumps(data),
    }
    await execute(
        "INSERT INTO environment_artifacts (project_id, id, slug) VALUES (:p, :a, :s)",
        params,
    )
    await execute(
        "INSERT INTO environment_variants (project_id, artifact_id, id, slug) "
        "VALUES (:p, :a, :v, :vs)",
        params,
    )
    await execute(
        "INSERT INTO environment_revisions (project_id, artifact_id, variant_id, id, "
        "slug, version, author, data) VALUES (:p, :a, :v, :r, "
        ":rs, '1', :p, CAST(:d AS jsonb))",
        params,
    )
    return slug


async def _resolve(project_id: UUID, environment_slug: str):
    return await _service().resolve_agent_artifact_id(
        project_id=project_id,
        references=[SessionReference(key="environment", slug=environment_slug)],
    )


async def test_live_deployment_resolves():
    async with seeded() as org:
        project_id = org.project_ids[0]
        agent = await _agent(project_id)
        slug = await _environment(project_id, agent)

        assert await _resolve(project_id, slug) == agent["artifact"]


async def test_archived_environment_is_unresolved():
    async with seeded() as org:
        project_id = org.project_ids[0]
        agent = await _agent(project_id)
        slug = await _environment(project_id, agent)
        await execute(
            "UPDATE environment_artifacts SET deleted_at = now() "
            "WHERE project_id = :p AND slug = :s",
            {"p": project_id, "s": slug},
        )

        with pytest.raises(AgentReferenceUnresolved):
            await _resolve(project_id, slug)


@pytest.mark.parametrize(
    "table", ["workflow_revisions", "workflow_variants", "workflow_artifacts"]
)
async def test_deleted_or_archived_deployed_agent_is_unresolved(table):
    async with seeded() as org:
        project_id = org.project_ids[0]
        agent = await _agent(project_id)
        slug = await _environment(project_id, agent)
        key = {
            "workflow_revisions": "revision",
            "workflow_variants": "variant",
            "workflow_artifacts": "artifact",
        }[table]
        await execute(
            f"UPDATE {table} SET deleted_at = now() WHERE project_id = :p AND id = :i",
            {"p": project_id, "i": agent[key]},
        )

        with pytest.raises(AgentReferenceUnresolved):
            await _resolve(project_id, slug)


async def test_deployed_revision_of_another_artifact_is_unresolved():
    async with seeded() as org:
        project_id = org.project_ids[0]
        agent, other = await _agent(project_id), await _agent(project_id)
        slug = await _environment(project_id, {**agent, "revision": other["revision"]})

        with pytest.raises(AgentReferenceUnresolved):
            await _resolve(project_id, slug)


async def test_deployed_revision_in_another_project_is_unresolved():
    async with seeded() as org:
        project_id, other_project = org.project_ids[0], org.project_ids[1]
        agent = await _agent(project_id)
        foreign = await _agent(other_project)
        slug = await _environment(
            project_id, {**agent, "revision": foreign["revision"]}
        )

        with pytest.raises(AgentReferenceUnresolved):
            await _resolve(project_id, slug)
