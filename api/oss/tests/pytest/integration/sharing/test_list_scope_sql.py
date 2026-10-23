"""Read scopes in SQL on the real database (agents): a private agent leaves every list
of other principals, inside the list's own statement and before windowing; the agent
create failure is the `agent_creation_failed` envelope; the scoped queries send no more
statements than before M3 (Task 0: WQ 1, WVQ 2, WRQ 3).

Every test seeds its own organization; the organization delete in `finally` cascades to
every row written here.
"""

from contextlib import asynccontextmanager
from typing import Optional
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

from uuid_utils.compat import uuid7

import httpx
import pytest
from fastapi import FastAPI, Request

import oss.src.core.workflows.service as workflows_service_module
import oss.src.dbs.postgres.folders.dbes  # noqa: F401  (workflow_artifacts.folder_id)
import oss.src.models.db_models  # noqa: F401  (the ORM tables)
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.sharing.dtos import AgentReadScope
from oss.src.core.sharing.types import AgentCreationFailed
from oss.src.core.workflows.dtos import WorkflowRevisionQuery
from oss.src.core.workflows.service import SimpleWorkflowsService, WorkflowsService
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.workflows.dao import WorkflowsDAO
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowRevisionDBE,
    WorkflowVariantDBE,
)
from oss.src.utils.env import env
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    seed_organization,
)
from oss.tests.pytest.utils.principals import make_envelope
from oss.tests.pytest.utils.sharing import register_sharing_service_for_tests
from oss.tests.pytest.utils.statements import count_statements


pytestmark = pytest.mark.integration

# Task 0 baseline (~/agenta-m3-qa/before/query-counts.json), the same in OSS and EE.
WQ, WVQ, WRQ = 1, 2, 3


@asynccontextmanager
async def seeded(*labels: str):
    org = await seed_organization(members={label: "editor" for label in labels})
    try:
        yield org
    finally:
        await delete_seeded_organization(org)


def _service() -> WorkflowsService:
    return WorkflowsService(
        workflows_dao=WorkflowsDAO(
            engine=get_transactions_engine(),
            ArtifactDBE=WorkflowArtifactDBE,
            VariantDBE=WorkflowVariantDBE,
            RevisionDBE=WorkflowRevisionDBE,
        )
    )


async def _agent(
    project_id: UUID,
    *,
    policy: Optional[tuple] = None,
) -> UUID:
    """An agent artifact with one variant and one agent revision. `policy` is
    (visibility, owner) for its `agent_access` row; None writes no row."""

    # Time-ordered ids: lists order by id, newest first.
    artifact_id, variant_id, revision_id = uuid7(), uuid7(), uuid7()
    slug = f"scope-{artifact_id.hex[-12:]}"
    await execute(
        "INSERT INTO workflow_artifacts (project_id, id, slug) VALUES (:p, :a, :s)",
        {"p": project_id, "a": artifact_id, "s": slug},
    )
    await execute(
        "INSERT INTO workflow_variants (project_id, artifact_id, id, slug) "
        "VALUES (:p, :a, :v, :s)",
        {"p": project_id, "a": artifact_id, "v": variant_id, "s": f"{slug}.v"},
    )
    await execute(
        "INSERT INTO workflow_revisions (project_id, artifact_id, variant_id, id, "
        "slug, author, flags) VALUES (:p, :a, :v, :r, :s, :p, "
        "CAST('{\"is_agent\": true}' AS jsonb))",
        {
            "p": project_id,
            "a": artifact_id,
            "v": variant_id,
            "r": revision_id,
            "s": f"{slug}.r",
        },
    )
    if policy is not None:
        visibility, owner = policy
        await execute(
            "INSERT INTO agent_access (project_id, artifact_id, visibility, "
            "owner_user_id) VALUES (:p, :a, :v, :o)",
            {"p": project_id, "a": artifact_id, "v": visibility, "o": owner},
        )
    return artifact_id


async def _visible(
    service: WorkflowsService,
    project_id: UUID,
    agents: list,
    scope: AgentReadScope,
) -> dict:
    refs = [Reference(id=agent) for agent in agents]
    workflows = await service.query_workflows(
        project_id=project_id, read_scope=scope, workflow_refs=refs
    )
    variants = await service.query_workflow_variants(
        project_id=project_id, read_scope=scope, workflow_refs=refs
    )
    revisions = await service.query_workflow_revisions(
        project_id=project_id, read_scope=scope, workflow_refs=refs
    )
    heads = await service.query_workflow_head_revisions(
        project_id=project_id,
        read_scope=scope,
        workflow_revision_query=WorkflowRevisionQuery(),
    )
    simple = await SimpleWorkflowsService(workflows_service=service).query(
        project_id=project_id, read_scope=scope, workflow_refs=refs
    )
    return {
        "workflows": {w.id for w in workflows},
        "variants": {v.workflow_id for v in variants},
        "revisions": {r.workflow_id for r in revisions},
        "heads": {r.workflow_id for r in heads if r.workflow_id in set(agents)},
        "simple": {w.id for w in simple},
    }


async def test_agent_queries_hide_other_owners_private():
    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        alices = await _agent(project_id, policy=("private", alice))
        bobs = await _agent(project_id, policy=("private", bob))
        shared = await _agent(project_id, policy=("project", bob))
        legacy = await _agent(project_id)
        agents = [alices, bobs, shared, legacy]
        service = _service()

        seen = await _visible(
            service, project_id, agents, AgentReadScope(owner_user_id=alice)
        )
        for name, ids in seen.items():
            assert ids == {alices, shared, legacy}, name

        seen = await _visible(
            service, project_id, agents, AgentReadScope(owner_user_id=None)
        )
        for name, ids in seen.items():
            assert ids == {shared, legacy}, name

        seen = await _visible(
            service, project_id, agents, AgentReadScope(owner_user_id=bob)
        )
        for name, ids in seen.items():
            assert ids == {bobs, shared, legacy}, name


async def test_agent_scope_applies_before_windowing():
    """Bob's newest private agent does not use a slot of Alice's page."""

    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        older = await _agent(project_id)
        newer = await _agent(project_id, policy=("project", alice))
        await _agent(project_id, policy=("private", bob))  # newest

        workflows = await _service().query_workflows(
            project_id=project_id,
            read_scope=AgentReadScope(owner_user_id=alice),
            windowing=Windowing(limit=2),
        )

        assert [w.id for w in workflows] == [newer, older]


async def test_agent_query_is_one_statement(monkeypatch):
    """The scope is a `NOT EXISTS` inside the list's own statement: the warm counts
    equal the pre-M3 baseline (Task 0)."""

    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    FakeCache().install(monkeypatch, workflows_service_module)

    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        await _agent(project_id, policy=("private", alice))
        await _agent(project_id, policy=("private", bob))
        service = _service()
        scope = AgentReadScope(owner_user_id=alice)
        engine = get_transactions_engine()

        calls = {
            "WQ": lambda: service.query_workflows(
                project_id=project_id, read_scope=scope
            ),
            "WVQ": lambda: service.query_workflow_variants(
                project_id=project_id, read_scope=scope
            ),
            "WRQ": lambda: service.query_workflow_revisions(
                project_id=project_id, read_scope=scope
            ),
        }
        counts = {}
        for name, call in calls.items():
            assert len(await call()) == 1  # warm: pool, mapper and artifact cache
            with count_statements(engine) as statements:
                assert len(await call()) == 1
            counts[name] = len(statements)

        assert counts == {"WQ": WQ, "WVQ": WVQ, "WRQ": WRQ}


async def test_agent_creation_failure_is_the_envelope_not_a_generic_500(monkeypatch):
    """The real router and service: the DAO raises `AgentCreationFailed`, the route
    answers 500 with the `agent_creation_failed` envelope (not the generic 500 of
    `@intercept_exceptions`)."""

    import oss.src.apis.fastapi.workflows.router as router_module
    from oss.src.apis.fastapi.workflows.router import WorkflowsRouter

    register_sharing_service_for_tests(monkeypatch)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(router_module, "invalidate_cache", AsyncMock())

    dao = AsyncMock()
    dao.create_agent_artifact.side_effect = AgentCreationFailed()
    router = WorkflowsRouter(
        workflows_service=WorkflowsService(workflows_dao=dao),
        environments_service=AsyncMock(),
    )
    user_id, project_id = uuid4(), uuid4()
    envelope = make_envelope(principal_id=user_id, project_id=project_id)

    app = FastAPI()

    @app.middleware("http")
    async def _state(request: Request, call_next):
        request.state.user_id = str(user_id)
        request.state.project_id = str(project_id)
        request.state.principal = envelope.authority.principal
        request.state.run_envelope = envelope
        return await call_next(request)

    app.include_router(router.router, prefix="/workflows")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/workflows/",
            json={"workflow": {"slug": "alices-agent", "flags": {"is_agent": True}}},
        )

    assert response.status_code == 500
    assert response.json() == {
        "detail": {
            "code": "agent_creation_failed",
            "message": "The agent was not created.",
            "retryable": True,
            "next_step": "Send the same request again.",
        }
    }
    dao.create_artifact.assert_not_called()
    access = dao.create_agent_artifact.call_args.kwargs["access"]
    assert access.owner_user_id == user_id
    assert access.visibility.value == "private"
