"""The requirements route: who the "user" items are checked for, and the agent they use."""

from types import SimpleNamespace
from typing import Any, List
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.workflows import router as router_module
from oss.src.apis.fastapi.workflows.models import (
    WorkflowRevisionRequirementsQueryRequest,
)
from oss.src.apis.fastapi.workflows.router import WorkflowsRouter
from oss.src.core.access.dtos import (
    PrincipalKind,
    PrincipalRef,
    RunAuthority,
    RunContext,
    RunEnvelope,
    RunOrigin,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.agent_requirements.dtos import AgentRequirements

pytestmark = pytest.mark.asyncio


class _Requirements:
    def __init__(self) -> None:
        self.calls: List[dict] = []

    async def check(self, **kwargs: Any) -> AgentRequirements:
        self.calls.append(kwargs)
        return AgentRequirements.of([])


class _Workflows:
    def __init__(self, artifact_id) -> None:
        self.artifact_id = artifact_id

    async def fetch_workflow_revision(self, *, project_id, workflow_revision_ref):
        return SimpleNamespace(
            artifact_id=self.artifact_id,
            workflow_id=self.artifact_id,
            data=SimpleNamespace(parameters={"agent": {}}),
        )


def _request(person) -> Any:
    project_id = uuid4()
    envelope = RunEnvelope(
        authority=RunAuthority(
            principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=person),
            organization_id=uuid4(),
            project_id=project_id,
        ),
        context=RunContext(origin=RunOrigin.WEB),
    )
    return SimpleNamespace(
        state=SimpleNamespace(
            user_id=str(person),
            project_id=str(project_id),
            organization_id=str(uuid4()),
            run_envelope=envelope,
        )
    )


@pytest.fixture
def route(monkeypatch):
    seen = SimpleNamespace(permissions=[], agents=[], hidden=set())

    async def _check_action_access(*, user_uid, project_id, permission):
        seen.permissions.append(permission)
        return True

    async def _allow_agent(request, *, action, artifact_id):
        seen.agents.append((action, artifact_id))
        return artifact_id not in seen.hidden

    monkeypatch.setattr(router_module, "check_action_access", _check_action_access)
    monkeypatch.setattr(router_module, "allow_agent", _allow_agent)
    monkeypatch.setattr(router_module, "artifact_id_of", lambda item: item.artifact_id)
    monkeypatch.setattr(router_module, "get_auth_scope", lambda: "scope")
    return seen


def _router(artifact_id) -> Any:
    router = object.__new__(WorkflowsRouter)
    router.workflows_service = _Workflows(artifact_id)
    router.requirements_service = _Requirements()
    return router


async def test_a_revision_is_checked_for_the_person_who_asks_and_its_agent(route):
    person, agent = uuid4(), uuid4()
    router = _router(agent)
    await router.query_workflow_revision_requirements(
        _request(person),
        body=WorkflowRevisionRequirementsQueryRequest(
            workflow_revision_ref={"id": str(uuid4())}
        ),
    )
    [call] = router.requirements_service.calls
    assert call["run_person_id"] == person
    assert call["artifact_id"] == agent

    # The fix of a "user" item goes to anyone who may run this agent.
    assert await call["may_run_agent"]() is True
    assert Permission.RUN_SESSIONS in route.permissions
    assert (Permission.RUN_SESSIONS, agent) in route.agents


async def test_a_draft_names_its_agent_with_workflow_id(route):
    agent = uuid4()
    router = _router(uuid4())
    await router.query_workflow_revision_requirements(
        _request(uuid4()),
        body=WorkflowRevisionRequirementsQueryRequest(
            parameters={"agent": {}}, workflow_id=agent
        ),
    )
    [call] = router.requirements_service.calls
    assert call["artifact_id"] == agent


async def test_a_hidden_agent_is_not_found(route):
    agent = uuid4()
    route.hidden.add(agent)
    router = _router(uuid4())
    with pytest.raises(HTTPException) as raised:
        await router.query_workflow_revision_requirements(
            _request(uuid4()),
            body=WorkflowRevisionRequirementsQueryRequest(
                parameters={"agent": {}}, workflow_id=agent
            ),
        )
    assert raised.value.status_code == 404
    assert router.requirements_service.calls == []


async def test_a_workflow_id_that_is_not_the_revisions_agent_is_not_found(route):
    router = _router(uuid4())
    with pytest.raises(HTTPException) as raised:
        await router.query_workflow_revision_requirements(
            _request(uuid4()),
            body=WorkflowRevisionRequirementsQueryRequest(
                workflow_revision_ref={"id": str(uuid4())}, workflow_id=uuid4()
            ),
        )
    assert raised.value.status_code == 404
