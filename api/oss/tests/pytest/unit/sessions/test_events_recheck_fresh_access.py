"""The live events stream (`GET /sessions/{id}/events`) rechecks access while it is
open. Its generator runs in a copy of the request context, so it shares the request's
access memo. Each recheck must read the current principal and membership, not the
answers that the check at connect put in that memo."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import FastAPI, Request

from oss.src.apis.fastapi.sessions import router as router_module
from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.service import AccessService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.utils.env import env
from oss.tests.pytest.utils.memberships import (
    InMemoryMembershipsDAO,
    RecordingRbac,
    make_summary,
)
from oss.tests.pytest.utils.principals import (
    InMemoryPrincipalsDAO,
    make_envelope,
    make_request_access,
)


class _World:
    def __init__(self):
        self.memberships_dao = InMemoryMembershipsDAO()
        self.principals = InMemoryPrincipalsDAO()
        self.organization_id = uuid4()
        self.project = self.memberships_dao.add_project(
            make_summary(organization_id=self.organization_id)
        )
        self.service = AccessService(
            memberships=MembershipsService(
                memberships_dao=self.memberships_dao,
                policy=MembershipPolicy.PROJECT_ROWS,
            ),
            rbac=RecordingRbac(enforced=True),
            principals=self.principals,
        )

    @property
    def project_id(self):
        return self.project.project_id

    def member(self, user, role="viewer"):
        self.memberships_dao.add_organization_member(
            organization_id=self.organization_id, user_id=user, role=role
        )
        self.memberships_dao.add_project_member(
            project_id=self.project_id, user_id=user, role=role
        )

    def drop(self, user):
        self.memberships_dao.organization_members = [
            m for m in self.memberships_dao.organization_members if m.user_id != user
        ]
        self.memberships_dao.project_members = [
            m for m in self.memberships_dao.project_members if m.user_id != user
        ]


def _request(project_id, user_id) -> Request:
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/sessions/session-1/events",
            "headers": [],
            "app": FastAPI(),
        }
    )
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


async def _open_stream(world: _World, access, user_id):
    """Opens the stream inside the request context and returns its recheck. The
    caller keeps the context set, as the streaming generator does."""

    router = SessionStreamsRouter(
        service=AsyncMock(),
        interactions_service=AsyncMock(),
        records_service=AsyncMock(),
    )
    captured = {}

    def _stream(**kwargs):
        captured.update(kwargs)

        async def _empty():
            if False:
                yield b""

        return _empty()

    with (
        patch.object(env.sessions, "shared_reader", True),
        patch.object(router_module, "live_event_stream", _stream),
        patch.object(router_module, "get_access_service", lambda: world.service),
    ):
        await router.session_events(
            request=_request(world.project_id, user_id), session_id="session-1"
        )
    return captured["authorization_check"]


async def test_recheck_refuses_a_member_removed_after_connect():
    world = _World()
    user = uuid4()
    world.member(user)
    human = world.principals.human(user)
    access = make_request_access(
        envelope=make_envelope(principal_id=human.id, project_id=world.project_id),
        credential_kind="bearer_session",
    )

    token = set_request_access(access)
    try:
        check = await _open_stream(world, access, user)

        assert await check() is True
        world.drop(user)
        assert await check() is False
    finally:
        reset_request_access(token)


async def test_recheck_refuses_an_api_key_deleted_after_connect():
    world = _World()
    creator = uuid4()
    world.member(creator)
    key = world.principals.api_key(project_id=world.project_id, created_by_id=creator)
    access = make_request_access(
        envelope=make_envelope(
            kind="api_key",
            principal_id=key.id,
            project_id=world.project_id,
            organization_id=world.organization_id,
        ),
        credential_kind="api_key",
        acting_user_id=creator,
    )

    token = set_request_access(access)
    try:
        check = await _open_stream(world, access, creator)

        assert await check() is True
        del world.principals.records[key]
        assert await check() is False
    finally:
        reset_request_access(token)
