"""`include_data: false` drops `data` from the revisions a query returns.

The router is built with a stub service and mounted on a bare app, so the real route, the
real params/body merge and the real response model all run.
"""

from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.workflows import router as workflows_router_module
from oss.src.apis.fastapi.workflows.router import WorkflowsRouter
from oss.src.core.workflows.dtos import (
    WorkflowFlags,
    WorkflowRevision,
    WorkflowRevisionData,
)


class _StubService:
    async def query_workflow_revisions(self, **_kwargs):
        return [
            WorkflowRevision(
                id=uuid4(),
                workflow_id=uuid4(),
                flags=WorkflowFlags(is_agent=True),
                data=WorkflowRevisionData(uri="agenta:builtin:agent:v0"),
            )
        ]


@pytest.fixture
def client(monkeypatch) -> TestClient:
    async def _allow(**_kwargs):
        return True

    async def _publish(**_kwargs):
        return None

    async def _read_scope(_request):
        return None

    monkeypatch.setattr(workflows_router_module, "check_action_access", _allow)
    monkeypatch.setattr(workflows_router_module, "publish_revision_event", _publish)
    monkeypatch.setattr(
        workflows_router_module,
        "agent_read_scope_for_request",
        _read_scope,
    )

    app = FastAPI()

    @app.middleware("http")
    async def _inject_principal(request: Request, call_next):
        request.state.user_id = str(uuid4())
        request.state.project_id = str(uuid4())
        return await call_next(request)

    service = _StubService()
    app.include_router(
        WorkflowsRouter(
            workflows_service=service,
            environments_service=service,
        ).router,
        prefix="/workflows",
    )

    return TestClient(app)


def _revision(response):
    assert response.status_code == 200
    assert response.json()["count"] == 1
    return response.json()["workflow_revisions"][0]


def test_include_data_false_omits_data_and_keeps_flags(client):
    revision = _revision(
        client.post("/workflows/revisions/query", json={"include_data": False})
    )

    assert "data" not in revision
    assert revision["flags"]["is_agent"] is True


def test_include_data_false_in_params_omits_data(client):
    revision = _revision(client.post("/workflows/revisions/query?include_data=false"))

    assert "data" not in revision


def test_data_is_returned_by_default(client):
    revision = _revision(client.post("/workflows/revisions/query", json={}))

    assert revision["data"]["uri"] == "agenta:builtin:agent:v0"
