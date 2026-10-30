"""`SharingRouter`: the error envelopes, hidden == unknown, the non-owner write refusal,
the members query for each credential kind, and the ten routes in the OpenAPI schema.

A real `AccessService` with `SharingService` as its resource policy, over in-memory
DAOs, decides every check. Alice owns a private agent, a project agent and a private
session (Vic holds a viewer grant on it); Bob and Vic are editors.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import oss.src.core.access.service as access_module
from oss.src.apis.fastapi.sharing.router import SharingRouter
from oss.src.apis.fastapi.sharing.utils import (
    NOT_FOUND_ERROR,
    handle_sharing_exceptions,
)
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.dtos import (
    Decision,
    DecisionReason,
    PrincipalKind,
    PrincipalRef,
    RequestAccess,
    RequestCredentialKind,
    RunAuthority,
    RunContext,
    RunEnvelope,
    RunOrigin,
    RunSender,
)
from oss.src.core.access.service import AccessService
from oss.src.core.access.types import AccessDenied
from oss.src.core.sessions.streams.dtos import SessionReference
from oss.src.core.sharing.dtos import AccessPolicy, SessionRole, Visibility
from oss.src.core.sharing.types import (
    AgentCreationFailed,
    InvalidGrantee,
    InvalidTransferTarget,
    OwnerStillActive,
    SessionNotShareable,
    SharedItemNotFound,
    SharingConflict,
)
from oss.src.utils.exceptions import intercept_exceptions
from oss.tests.pytest.utils.memberships import RecordingRbac
from oss.tests.pytest.utils.principals import InMemoryPrincipalsDAO
from oss.tests.pytest.utils.sharing import SharingWorld

pytestmark = pytest.mark.real_resource_checks

API_DIR = Path(__file__).resolve().parents[5]

OPERATION_IDS = {
    "fetch_agent_sharing",
    "set_agent_visibility",
    "transfer_agent",
    "take_agent_ownership",
    "fetch_session_sharing",
    "upsert_session_grant",
    "revoke_session_grant",
    "set_session_visibility",
    "restrict_session_to_owner",
    "query_sharing_members",
}

_TOOLS = {
    "tools": [
        {
            "type": "gateway",
            "provider": "composio",
            "integration": "github",
            "action": "GITHUB_CREATE_ISSUE",
            "connection": "team-github",
        }
    ]
}


def _private(owner: UUID) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


class _Workflows:
    """The workflows that exist (`artifacts`) and which of them are agents (`agents`);
    every head revision uses one gateway connection."""

    def __init__(self) -> None:
        self.artifacts: set = set()
        self.agents: set = set()

    async def is_agent_artifact(self, *, project_id, artifact_id):
        return artifact_id in self.agents

    async def fetch_workflow(self, *, project_id, workflow_ref, **_kwargs):
        if workflow_ref.id in self.artifacts:
            return SimpleNamespace(id=workflow_ref.id)
        return None

    async def fetch_workflow_revision(self, *, project_id, workflow_ref, **_kwargs):
        if workflow_ref.id in self.artifacts:
            return SimpleNamespace(data=SimpleNamespace(parameters=_TOOLS))
        return None

    async def resolve_agent_artifact_id(self, *, project_id, references):
        for reference in references or []:
            if reference.key == "workflow":
                return reference.id
        return None


class _Streams:
    def __init__(self) -> None:
        self.references: dict = {}

    async def fetch(self, *, project_id, session_id):
        if session_id not in self.references:
            return None
        return SimpleNamespace(references=self.references[session_id])


class _World:
    def __init__(self) -> None:
        self.world = SharingWorld()
        self.project_id = self.world.project_id
        self.organization_id = self.world.organization_id
        self.alice = self.world.add_member(uuid4())
        self.bob = self.world.add_member(uuid4())
        self.vic = self.world.add_member(uuid4())
        self.dan = self.world.add_member(uuid4(), role="admin")
        for user, email in ((self.alice, "alice@x.io"), (self.bob, "bob@x.io")):
            self.world.memberships_dao.users[user] = (email, None)
        self.principals = InMemoryPrincipalsDAO()
        for user in (self.alice, self.bob, self.vic, self.dan):
            self.principals.human(user)
        self.access = AccessService(
            memberships=self.world.service._memberships,
            rbac=RecordingRbac(entitled=True),
            principals=self.principals,
            resource_policy=self.world.service,
        )
        self.workflows = _Workflows()
        self.streams = _Streams()

        self.private_agent = self._agent(_private(self.alice))
        self.project_agent = self._agent(
            AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=self.alice)
        )
        self.private_session = self.world.add_session(policy=_private(self.alice))
        self.streams.references[self.private_session.session_id] = [
            SessionReference(key="workflow", id=self.project_agent)
        ]
        self.world.add_grant(
            state=self.private_session, user_id=self.vic, role=SessionRole.VIEWER
        )

    def _agent(self, policy: AccessPolicy) -> UUID:
        artifact_id = self.world.dao.add_agent(
            project_id=self.project_id, policy=policy
        )
        self.workflows.artifacts.add(artifact_id)
        self.workflows.agents.add(artifact_id)
        return artifact_id

    def non_agent(self) -> UUID:
        """A workflow that is not an agent (a prompt or an evaluator): it exists, it
        has no access row."""
        artifact_id = uuid4()
        self.workflows.artifacts.add(artifact_id)
        # The DAO fake would write its policy: only the router's agent check refuses.
        self.world.dao.artifacts.add((self.project_id, artifact_id))
        return artifact_id

    def request_access(
        self, user_id: UUID, credential: str = "bearer"
    ) -> RequestAccess:
        if credential == "api_key":
            principal = self.principals.api_key(
                project_id=self.project_id, created_by_id=user_id
            )
        else:
            principal = PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)
        # A browser session's authority names no project of the request.
        authority = RunAuthority(
            principal=principal,
            organization_id=self.organization_id,
            project_id=uuid4() if credential == "bearer" else self.project_id,
        )
        kind = {
            "bearer": RequestCredentialKind.BEARER_SESSION,
            "api_key": RequestCredentialKind.API_KEY,
            "secret": RequestCredentialKind.RUN_CREDENTIAL,
        }[credential]
        envelope = (
            RunEnvelope(
                authority=authority,
                context=RunContext(origin=RunOrigin.WEB),
                sender=RunSender(user_id=user_id),
            )
            if kind == RequestCredentialKind.RUN_CREDENTIAL
            else None
        )
        return RequestAccess(
            principal=principal,
            authority=authority,
            credential_kind=kind,
            acting_user_id=user_id,
            envelope=envelope,
        )

    def client(self, user_id: UUID, credential: str = "bearer") -> TestClient:
        router = SharingRouter(
            sharing_service=self.world.service,
            memberships_service=self.world.service._memberships,
            workflows_service=self.workflows,
            streams_service=self.streams,
        )
        app = FastAPI()

        @app.middleware("http")
        async def scope(request: Request, call_next):
            request.state.project_id = str(self.project_id)
            request.state.organization_id = str(self.organization_id)
            request.state.user_id = str(user_id)
            token = set_request_access(self.request_access(user_id, credential))
            try:
                return await call_next(request)
            finally:
                reset_request_access(token)

        app.include_router(router.router, tags=["Sharing"])
        return TestClient(app)


@pytest.fixture
def world(monkeypatch) -> _World:
    world = _World()
    monkeypatch.setattr(access_module, "_access_service", world.access)
    return world


# -- error envelopes --------------------------------------------------------------------


def _envelope_app(error: Exception) -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def scope(request: Request, call_next):
        request.state.project_id = str(uuid4())
        token = set_request_access(
            RequestAccess(
                principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4()),
                authority=RunAuthority(
                    principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4()),
                    organization_id=uuid4(),
                    project_id=uuid4(),
                ),
                credential_kind=RequestCredentialKind.BEARER_SESSION,
                acting_user_id=uuid4(),
            )
        )
        try:
            return await call_next(request)
        finally:
            reset_request_access(token)

    @intercept_exceptions()
    @handle_sharing_exceptions()
    async def route(request: Request):
        raise error

    app.add_api_route("/x", route, methods=["GET"])
    return TestClient(app)


_RETRY = "Reload the sharing state and retry."


@pytest.mark.parametrize(
    "error, status, code, retryable, next_step, details",
    [
        (SharedItemNotFound(), 404, "not_found", False, None, None),
        (SharingConflict(current=None), 409, "sharing_conflict", True, _RETRY, None),
        (
            InvalidGrantee(user_id=UUID(int=1), reason="owner"),
            422,
            "invalid_grantee",
            False,
            None,
            {"user_id": str(UUID(int=1)), "reason": "owner"},
        ),
        (
            SessionNotShareable(reason="channel"),
            409,
            "session_not_shareable",
            False,
            None,
            {"reason": "channel"},
        ),
        (OwnerStillActive(), 409, "owner_active", False, None, None),
        (
            InvalidTransferTarget(user_id=UUID(int=2)),
            422,
            "invalid_transfer_target",
            False,
            None,
            {"user_id": str(UUID(int=2))},
        ),
        (
            AgentCreationFailed(),
            500,
            "agent_creation_failed",
            True,
            "Send the same request again.",
            None,
        ),
    ],
)
async def test_error_envelopes(error, status, code, retryable, next_step, details):
    response = _envelope_app(error).get("/x")

    assert response.status_code == status
    detail = response.json()["detail"]
    assert detail["code"] == code
    assert detail["retryable"] is retryable
    assert detail.get("next_step") == next_step
    assert detail.get("details") == details
    assert detail["message"]
    if isinstance(error, SharedItemNotFound):
        assert detail == NOT_FOUND_ERROR.model_dump(exclude_none=True)


async def test_resource_denied_is_403_access_denied():
    error = AccessDenied(
        decision=Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED)
    )
    response = _envelope_app(error).get("/x")

    assert response.status_code == 403
    detail = response.json()["detail"]
    assert detail["code"] == "access_denied"
    assert detail["retryable"] is False
    assert detail["next_step"] == "Ask a project admin for access."
    assert detail["details"]["reason"] == "resource_denied"


# -- hidden == unknown ------------------------------------------------------------------


_CANONICAL = {"detail": NOT_FOUND_ERROR.model_dump(exclude_none=True)}

# Every route that names a resource (the members query names none): method, path
# template, body. `{id}` is the agent or session id.
_AGENT_ROUTES = [
    ("GET", "/workflows/{id}/sharing", None),
    ("POST", "/workflows/{id}/sharing/visibility", {"visibility": "project"}),
    ("POST", "/workflows/{id}/sharing/transfer", "transfer"),
    ("POST", "/workflows/{id}/sharing/take-ownership", None),
]
_SESSION_ROUTES = [
    ("GET", "/sessions/{id}/sharing", None),
    ("POST", "/sessions/{id}/sharing/grants", "grant"),
    ("DELETE", "/sessions/{id}/sharing/grants/{user}", None),
    ("POST", "/sessions/{id}/sharing/visibility", {"visibility": "project"}),
    ("POST", "/sessions/{id}/sharing/only-me", None),
]


def _call(world, client, method, template, body, resource_id):
    path = template.format(id=resource_id, user=world.vic)
    if body == "transfer":
        body = {"user_id": str(world.vic)}
    elif body == "grant":
        body = {"user_id": str(world.vic), "role": "viewer"}
    return client.request(method, path, json=body)


@pytest.mark.parametrize("user", ["bob", "dan"])
@pytest.mark.parametrize("method, template, body", _AGENT_ROUTES)
async def test_hidden_agent_answers_like_unknown_on_every_route(
    world, user, method, template, body
):
    client = world.client(getattr(world, user))
    hidden = _call(world, client, method, template, body, world.private_agent)
    unknown = _call(world, client, method, template, body, uuid4())

    assert (hidden.status_code, hidden.json()) == (
        unknown.status_code,
        unknown.json(),
    )
    if user == "bob" and not template.endswith("take-ownership"):
        # Bob lacks the take-ownership capability: both answer the same 403.
        assert (hidden.status_code, hidden.json()) == (404, _CANONICAL)


@pytest.mark.parametrize("user", ["bob", "dan"])
@pytest.mark.parametrize("method, template, body", _SESSION_ROUTES)
async def test_hidden_session_answers_like_unknown_on_every_route(
    world, user, method, template, body
):
    client = world.client(getattr(world, user))
    session_id = world.private_session.session_id
    hidden = _call(world, client, method, template, body, session_id)
    unknown = _call(world, client, method, template, body, f"s-{uuid4().hex}")

    assert (hidden.status_code, hidden.json()) == (
        unknown.status_code,
        unknown.json(),
    )
    if user == "bob":
        assert (hidden.status_code, hidden.json()) == (404, _CANONICAL)


@pytest.mark.parametrize("user", ["alice", "dan"])
@pytest.mark.parametrize("method, template, body", _AGENT_ROUTES)
async def test_non_agent_workflow_answers_like_unknown(
    world, user, method, template, body
):
    """A prompt or an evaluator is no agent: every agent sharing route answers the
    canonical 404, as for an unknown id, even for an admin (no take-ownership of a
    prompt, no private prompt)."""
    client = world.client(getattr(world, user))
    prompt = world.non_agent()
    response = _call(world, client, method, template, body, prompt)
    unknown = _call(world, client, method, template, body, uuid4())

    assert (response.status_code, response.json()) == (
        unknown.status_code,
        unknown.json(),
    )
    if user == "dan" or not template.endswith("take-ownership"):
        # Alice lacks the take-ownership capability: both answer the same 403.
        assert (response.status_code, response.json()) == (404, _CANONICAL)
    assert (world.project_id, prompt) not in world.world.dao.agents


async def test_owner_reads_agent_sharing_with_disclosure(world):
    response = world.client(world.alice).get(
        f"/workflows/{world.private_agent}/sharing"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["sharing"]["my_role"] == "owner"
    assert body["sharing"]["policy"]["visibility"] == "private"
    assert body["disclosure"]["connections"] == [
        {"provider": "composio", "integration": "github", "connection": "team-github"}
    ]


async def test_sharing_an_agent_with_a_personal_tool_names_it_without_a_slug(
    world, monkeypatch
):
    """A "user" Gmail tool has no connection slug; the read used to fail with a 500."""
    personal = {
        "agent": {
            "tools": [
                {
                    "type": "gateway_connection",
                    "connection": {
                        "provider": "composio",
                        "integration": "gmail",
                        "account_source": "user",
                    },
                }
            ]
        }
    }

    async def fetch_workflow_revision(*, project_id, workflow_ref, **_kwargs):
        return SimpleNamespace(data=SimpleNamespace(parameters=personal))

    monkeypatch.setattr(
        world.workflows, "fetch_workflow_revision", fetch_workflow_revision
    )
    response = world.client(world.alice).get(
        f"/workflows/{world.private_agent}/sharing"
    )
    assert response.status_code == 200, response.text
    assert response.json()["disclosure"]["connections"] == [
        {"provider": "composio", "integration": "gmail", "account_source": "user"}
    ]


# -- writes -----------------------------------------------------------------------------


async def test_non_owner_write_is_403_access_denied(world):
    # Bob reads the project agent but does not own it.
    response = world.client(world.bob).post(
        f"/workflows/{world.project_agent}/sharing/visibility",
        json={"visibility": "private"},
    )
    assert response.status_code == 403
    detail = response.json()["detail"]
    assert detail["code"] == "access_denied"
    assert detail["details"]["reason"] == "resource_denied"

    # Vic reads Alice's private session (viewer grant) but may not share it.
    response = world.client(world.vic).post(
        f"/sessions/{world.private_session.session_id}/sharing/grants",
        json={"user_id": str(world.bob), "role": "viewer"},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["details"]["reason"] == "resource_denied"


async def test_owner_shares_a_session_and_the_grantee_sees_no_grants(world):
    session_id = world.private_session.session_id
    alice = world.client(world.alice)

    response = alice.post(
        f"/sessions/{session_id}/sharing/grants",
        json={"user_id": str(world.bob), "role": "participant"},
    )
    assert response.status_code == 200
    body = response.json()
    assert {grant["user_id"] for grant in body["sharing"]["grants"]} == {
        str(world.vic),
        str(world.bob),
    }
    assert body["disclosure"]["connections"][0]["connection"] == "team-github"

    response = world.client(world.bob).get(f"/sessions/{session_id}/sharing")
    assert response.status_code == 200
    sharing = response.json()["sharing"]
    assert sharing["my_role"] == "participant"
    assert sharing["grants"] == []
    assert sharing["can_send"] is True

    # A viewer reads but cannot send.
    sharing = (
        world.client(world.vic).get(f"/sessions/{session_id}/sharing").json()["sharing"]
    )
    assert (sharing["my_role"], sharing["can_send"]) == ("viewer", False)

    response = alice.delete(f"/sessions/{session_id}/sharing/grants/{world.bob}")
    assert response.status_code == 200
    assert (
        world.client(world.bob).get(f"/sessions/{session_id}/sharing").status_code
        == 404
    )

    response = alice.post(f"/sessions/{session_id}/sharing/only-me")
    assert response.status_code == 200
    assert response.json()["sharing"]["grants"] == []


async def test_invalid_grantee_answers_422(world):
    response = world.client(world.alice).post(
        f"/sessions/{world.private_session.session_id}/sharing/grants",
        json={"user_id": str(world.alice), "role": "viewer"},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_grantee"


# -- members ----------------------------------------------------------------------------


@pytest.mark.parametrize("credential", ["bearer", "api_key", "secret"])
async def test_members_query_works_for_each_credential(world, credential):
    client = world.client(world.alice, credential)

    response = client.post("/sharing/members/query", json={})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 4
    assert "windowing" not in body

    # Query parameters merge with the body; a full page returns the next cursor.
    first = client.post("/sharing/members/query?limit=1", json={"search": "zzz"})
    assert first.json()["count"] == 0
    first = client.post("/sharing/members/query?limit=1", json={})
    assert first.json()["count"] == 1
    cursor = first.json()["windowing"]
    assert cursor["limit"] == 1 and cursor["next"]

    seen = [first.json()["members"][0]["user_id"]]
    while cursor:
        page = client.post("/sharing/members/query", json={"windowing": cursor}).json()
        seen += [member["user_id"] for member in page["members"]]
        cursor = page.get("windowing")
    assert sorted(seen) == sorted(
        str(u) for u in (world.alice, world.bob, world.vic, world.dan)
    )


# -- OpenAPI ----------------------------------------------------------------------------


def print_sharing_operations() -> None:
    """Run in a fresh interpreter: the API's real app, its OpenAPI operations under the
    "Sharing" tag, as JSON."""

    from unittest.mock import patch  # noqa: PLC0415

    with patch("alembic.script.ScriptDirectory.from_config", return_value=object()):
        from entrypoints.routers import app  # noqa: PLC0415

    operations = []
    for path, methods in app.openapi()["paths"].items():
        for method, operation in methods.items():
            if "Sharing" in operation.get("tags", []):
                operations.append([path, method, operation["operationId"]])
    print("SHARING_OPERATIONS " + json.dumps(operations))


def test_routes_have_operation_ids_and_sharing_tag():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from oss.tests.pytest.unit.sharing.test_sharing_router_errors import "
            "print_sharing_operations; print_sharing_operations()",
        ],
        cwd=API_DIR,
        env=dict(os.environ),
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, result.stderr[-4000:]
    line: Optional[str] = next(
        (
            line
            for line in result.stdout.splitlines()
            if line.startswith("SHARING_OPERATIONS ")
        ),
        None,
    )
    assert line is not None, result.stdout[-2000:]
    operations = json.loads(line.removeprefix("SHARING_OPERATIONS "))

    assert {operation_id for _, _, operation_id in operations} == OPERATION_IDS
    assert len(operations) == len(OPERATION_IDS)
    assert ["/sharing/members/query", "post", "query_sharing_members"] in operations
    assert [
        "/sessions/{session_id}/sharing/grants/{user_id}",
        "delete",
        "revoke_session_grant",
    ] in operations
