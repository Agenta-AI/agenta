"""`/approval-choices`: only the signed-in person sets, lists or removes a choice, and
only the builder's `ask` tools accept one (design D32)."""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import oss.src.apis.fastapi.approval_choices.router as router_module
from oss.src.apis.fastapi.approval_choices.router import ApprovalChoicesRouter
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.approval_choices.dtos import ApprovalChoice
from oss.src.core.approval_choices.service import ApprovalChoicesService
from oss.src.core.workflows.static_catalog import BUILDER_AGENT_ID
from oss.tests.pytest.utils.principals import make_envelope, make_request_access


class _InMemoryDAO:
    def __init__(self):
        self.rows = {}

    async def create(self, *, project_id, user_id, choice):
        key = (project_id, user_id, choice.workflow_id, choice.tool_key)
        if key not in self.rows:
            self.rows[key] = ApprovalChoice(
                id=uuid4(), workflow_id=choice.workflow_id, tool_key=choice.tool_key
            )
        return self.rows[key]

    async def query(self, *, project_id, user_id, query):
        return [
            row
            for (project, user, _, tool_key), row in self.rows.items()
            if project == project_id
            and user == user_id
            and (query.tool_key is None or tool_key == query.tool_key)
        ]

    async def delete(self, *, project_id, user_id, approval_choice_id):
        for key, row in list(self.rows.items()):
            if key[:2] == (project_id, user_id) and row.id == approval_choice_id:
                del self.rows[key]
                return True
        return False


@pytest.fixture
def state(monkeypatch):
    async def _may_run(**_kwargs):
        return state["may_run"]

    monkeypatch.setattr(router_module, "check_action_access", _may_run)
    state = {
        "organization": uuid4(),
        "project": uuid4(),
        "person": uuid4(),
        "kind": "human",
        "credential": "bearer_session",
        "may_run": True,
        "dao": _InMemoryDAO(),
    }
    return state


def _client(state) -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def principal(request, call_next):
        request.state.user_id = str(state["person"])
        request.state.organization_id = str(state["organization"])
        request.state.project_id = str(state["project"])
        envelope = make_envelope(
            kind=state["kind"],
            principal_id=state["person"],
            organization_id=state["organization"],
            project_id=state["project"],
        )
        access = make_request_access(
            envelope=envelope, credential_kind=state["credential"]
        )
        token = set_request_access(access)
        try:
            return await call_next(request)
        finally:
            reset_request_access(token)

    router = ApprovalChoicesRouter(
        approval_choices_service=ApprovalChoicesService(
            approval_choices_dao=state["dao"]
        )
    )
    app.include_router(router.router)
    return TestClient(app, raise_server_exceptions=False)


def _body(tool_key="tools.agenta.start_session", workflow_id=BUILDER_AGENT_ID):
    return {"approval_choice": {"workflow_id": str(workflow_id), "tool_key": tool_key}}


@pytest.mark.parametrize(
    "tool_key",
    [
        "tools.agenta.start_session",
        "tools.agenta.create_agent",
        "tools.agenta.edit_agent_config",
    ],
)
def test_the_person_sets_a_choice_for_a_builder_tool(state, tool_key):
    response = _client(state).post("/", json=_body(tool_key))
    assert response.status_code == 200
    assert response.json()["approval_choice"]["tool_key"] == tool_key
    assert response.json()["approval_choice"]["workflow_id"] == str(BUILDER_AGENT_ID)


def test_the_same_choice_twice_is_one_row(state):
    client = _client(state)
    first = client.post("/", json=_body()).json()["approval_choice"]["id"]
    second = client.post("/", json=_body()).json()["approval_choice"]["id"]
    assert first == second
    assert len(state["dao"].rows) == 1


@pytest.mark.parametrize(
    "body",
    [
        _body("tools.agenta.commit_revision"),
        _body("tools.agenta.send_session_message"),
        _body("start_session"),
        _body(workflow_id=uuid4()),
    ],
)
def test_another_tool_or_agent_is_refused(state, body):
    response = _client(state).post("/", json=body)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "approval_choice_not_supported"
    assert not state["dao"].rows


@pytest.mark.parametrize(
    "kind, credential",
    [("human", "run_credential"), ("api_key", "api_key")],
)
def test_a_run_credential_or_an_api_key_is_refused(state, kind, credential):
    state["kind"], state["credential"] = kind, credential
    client = _client(state)
    assert client.post("/", json=_body()).status_code == 403
    assert client.post("/query", json={}).status_code == 403
    assert client.delete(f"/{uuid4()}").status_code == 403
    assert not state["dao"].rows


def test_a_person_who_cannot_run_sessions_is_refused(state):
    state["may_run"] = False
    assert _client(state).post("/", json=_body()).status_code == 403
    assert not state["dao"].rows


def test_the_person_lists_and_removes_only_their_own_choice(state):
    client = _client(state)
    mine = client.post("/", json=_body()).json()["approval_choice"]["id"]
    listed = client.post("/query", json={}).json()["approval_choices"]
    assert [row["id"] for row in listed] == [mine]

    # Another person in the same project sees nothing and cannot remove it.
    owner = state["person"]
    state["person"] = uuid4()
    other = _client(state)
    assert other.post("/query", json={}).json()["count"] == 0
    assert other.delete(f"/{mine}").status_code == 204
    assert len(state["dao"].rows) == 1

    state["person"] = owner
    assert client.delete(f"/{mine}").status_code == 204
    assert not state["dao"].rows
