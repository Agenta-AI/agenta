"""The workflow routes pass the request principal's agent read scope to every query
and the ownership rule's owner to every commit."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import oss.src.apis.fastapi.workflows.router as router_module
from oss.src.apis.fastapi.sharing.utils import agent_read_scope_for_request
from oss.src.apis.fastapi.workflows.router import WorkflowsRouter
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.sharing.dtos import AgentReadScope
from oss.tests.pytest.utils.principals import make_envelope
from oss.tests.pytest.utils.sharing import register_sharing_service_for_tests


@pytest.fixture(autouse=True)
def _sharing(monkeypatch):
    register_sharing_service_for_tests(monkeypatch)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )


def _request(principal=None, envelope=None):
    async def _json():
        return {}

    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(uuid4()),
            user_id=str(uuid4()),
            principal=principal,
            run_envelope=envelope,
        ),
        json=_json,
    )


@pytest.mark.parametrize(
    "principal, owner",
    [
        (PrincipalRef(kind=PrincipalKind.HUMAN, id=(alice := uuid4())), alice),
        (PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4()), None),
        (PrincipalRef(kind=PrincipalKind.INSTALLATION, id=uuid4()), None),
        (None, None),
    ],
)
async def test_read_scope_comes_from_the_principal(principal, owner):
    scope = await agent_read_scope_for_request(_request(principal))

    assert scope == AgentReadScope(owner_user_id=owner)


async def test_query_route_passes_the_read_scope():
    service = AsyncMock()
    service.query_workflows.return_value = []
    router = WorkflowsRouter(
        workflows_service=service, environments_service=AsyncMock()
    )
    alice = uuid4()

    await router.query_workflows(
        _request(PrincipalRef(kind=PrincipalKind.HUMAN, id=alice)),
        query_request_params=None,
    )

    assert service.query_workflows.await_args.kwargs["read_scope"] == (
        AgentReadScope(owner_user_id=alice)
    )


async def test_initial_revision_route_passes_the_owner(monkeypatch):
    from oss.src.apis.fastapi.workflows.models import WorkflowRevisionCreateRequest

    monkeypatch.setattr(router_module, "invalidate_cache", AsyncMock())
    monkeypatch.setattr(router_module, "_require_secret_attachment_access", AsyncMock())
    monkeypatch.setattr(
        router_module, "_emit_committed_revision_data_event", AsyncMock()
    )
    service = AsyncMock()
    service.commit_workflow_revision.return_value = None
    router = WorkflowsRouter(
        workflows_service=service, environments_service=AsyncMock()
    )
    envelope = make_envelope()

    await router.create_workflow_revision(
        _request(envelope.authority.principal, envelope),
        workflow_revision_create_request=WorkflowRevisionCreateRequest.model_validate(
            {"workflow_revision": {"workflow_variant_id": str(uuid4())}}
        ),
    )

    assert (
        service.commit_workflow_revision.await_args.kwargs["first_agent_owner_user_id"]
        == envelope.authority.principal.id
    )
