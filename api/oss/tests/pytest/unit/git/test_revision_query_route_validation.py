"""Read routes must report validation and permission failures, not swallow them.

Both failures are invisible from the pydantic layer alone. Grouping and windowing are
rejected by the request model, but the workflows and environments revision-query routes
merge query params into the body model inside the handler, so that rejection happens
under `suppress_exceptions` rather than under FastAPI's own body validation. The
applications routes take a single body model and have no merge, so what they can lose is
their 403.

The routers are built with stub services and mounted on a bare app, so the real route
registration, the real `Depends` param parsing and the real decorator stack all run.
"""

from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.applications import router as applications_router_module
from oss.src.apis.fastapi.applications.router import (
    ApplicationsRouter,
    SimpleApplicationsRouter,
)
from oss.src.apis.fastapi.environments import router as environments_router_module
from oss.src.apis.fastapi.environments.router import EnvironmentsRouter
from oss.src.apis.fastapi.workflows import router as workflows_router_module
from oss.src.apis.fastapi.workflows.router import WorkflowsRouter


GROUPING = {"by": "artifact", "get": "latest"}


class _StubService:
    """Answers every query with an empty list and every fetch with nothing."""

    async def query_workflow_revisions(self, **_kwargs):
        return []

    async def query_environment_revisions(self, **_kwargs):
        return []

    async def query_application_revisions(self, **_kwargs):
        return []

    async def query_applications(self, **_kwargs):
        return []

    async def fetch_application(self, **_kwargs):
        return None

    async def fetch(self, **_kwargs):
        return None

    @property
    def applications_service(self):
        # `SimpleApplicationsRouter` reads this off its service when it is constructed.
        return self


def _build_client(monkeypatch, *, access_allowed: bool = True) -> TestClient:
    async def _check_action_access(**_kwargs):
        return access_allowed

    async def _publish_revision_event(**_kwargs):
        return None

    stub_service = _StubService()

    for module in (
        workflows_router_module,
        environments_router_module,
        applications_router_module,
    ):
        monkeypatch.setattr(
            module, "check_action_access", _check_action_access, raising=False
        )
        monkeypatch.setattr(
            module, "publish_revision_event", _publish_revision_event, raising=False
        )

    app = FastAPI()

    @app.middleware("http")
    async def _inject_principal(request: Request, call_next):
        request.state.user_id = str(uuid4())
        request.state.project_id = str(uuid4())
        return await call_next(request)

    app.include_router(
        WorkflowsRouter(
            workflows_service=stub_service,
            environments_service=stub_service,
        ).router,
        prefix="/workflows",
    )
    app.include_router(
        EnvironmentsRouter(environments_service=stub_service).router,
        prefix="/environments",
    )
    app.include_router(
        ApplicationsRouter(
            applications_service=stub_service,
            environments_service=stub_service,
        ).router,
        prefix="/applications",
    )
    app.include_router(
        SimpleApplicationsRouter(simple_applications_service=stub_service).router,
        prefix="/simple/applications",
    )

    return TestClient(app)


@pytest.mark.parametrize(
    "prefix, refs_field",
    [
        ("/workflows", "workflow_refs"),
        ("/environments", "environment_refs"),
    ],
)
def test_grouping_in_body_with_windowing_in_params_returns_422(
    monkeypatch, prefix, refs_field
):
    client = _build_client(monkeypatch)

    response = client.post(
        f"{prefix}/revisions/query?limit=1",
        json={refs_field: [{"id": str(uuid4())}], "grouping": GROUPING},
    )

    assert response.status_code == 422
    assert "grouping cannot be combined with windowing" in response.text


@pytest.mark.parametrize(
    "prefix, refs_field",
    [
        ("/workflows", "workflow_refs"),
        ("/environments", "environment_refs"),
    ],
)
def test_grouping_in_body_with_windowing_in_body_still_returns_422(
    monkeypatch, prefix, refs_field
):
    client = _build_client(monkeypatch)

    response = client.post(
        f"{prefix}/revisions/query",
        json={
            refs_field: [{"id": str(uuid4())}],
            "grouping": GROUPING,
            "windowing": {"limit": 1},
        },
    )

    assert response.status_code == 422
    assert "grouping cannot be combined with windowing" in response.text


@pytest.mark.parametrize(
    "prefix, refs_field",
    [
        ("/workflows", "workflow_refs"),
        ("/environments", "environment_refs"),
        ("/applications", "application_refs"),
    ],
)
def test_grouping_without_windowing_is_accepted(monkeypatch, prefix, refs_field):
    client = _build_client(monkeypatch)

    response = client.post(
        f"{prefix}/revisions/query",
        json={refs_field: [{"id": str(uuid4())}], "grouping": GROUPING},
    )

    assert response.status_code == 200
    assert response.json()["count"] == 0


@pytest.mark.parametrize(
    "prefix, refs_field",
    [
        ("/workflows", "workflow_refs"),
        ("/environments", "environment_refs"),
        ("/applications", "application_refs"),
    ],
)
def test_denied_access_returns_403(monkeypatch, prefix, refs_field):
    client = _build_client(monkeypatch, access_allowed=False)

    response = client.post(
        f"{prefix}/revisions/query",
        json={refs_field: [{"id": str(uuid4())}]},
    )

    assert response.status_code == 403


@pytest.mark.parametrize(
    "method, path, body",
    [
        ("GET", "/applications/{application_id}", None),
        ("POST", "/applications/query", {}),
        ("GET", "/simple/applications/{application_id}", None),
    ],
)
def test_denied_access_on_the_application_read_routes_returns_403(
    monkeypatch, method, path, body
):
    """These share the revision-query route's decorator, so they share its defect."""
    client = _build_client(monkeypatch, access_allowed=False)

    url = path.format(application_id=str(uuid4()))
    response = client.get(url) if method == "GET" else client.post(url, json=body)

    assert response.status_code == 403
