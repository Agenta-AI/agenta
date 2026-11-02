"""The live events stream (`GET /sessions/{id}/events`) rechecks access while it is
open. Its generator runs in a copy of the request context, so it shares the request's
access memo. Each recheck must read the current principal and membership, not the
answers that the check at connect put in that memo."""

import asyncio
import contextvars
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request

from oss.src.apis.fastapi.sessions import router as router_module
from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
import oss.src.apis.fastapi.sharing.utils as sharing_utils
from oss.src.core.access.context import (
    fresh_request_memo,
    get_request_memo,
    reset_request_access,
    set_request_access,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.utils.env import env
from oss.tests.pytest.utils.memberships import (
    InMemoryMembershipsDAO,
    RecordingRbac,
    make_summary,
)
from oss.tests.pytest.utils.sharing import AllowAllResourcePolicy, NoopRunAdmission
from oss.tests.pytest.utils.principals import (
    InMemoryPrincipalsDAO,
    make_envelope,
    make_request_access,
)


# The recheck is the real session resource check (no allow-all stub).
pytestmark = pytest.mark.real_resource_checks


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
            rbac_entitlement=RecordingRbac(entitled=True),
            principals=self.principals,
            resource_policy=AllowAllResourcePolicy(),
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


async def _open_stream(world: _World, access, user_id, monkeypatch):
    """Opens the stream inside the request context and returns its recheck. The
    caller keeps the context set, as the streaming generator does. The recheck reads
    the access service when it runs, so the world's service stays registered."""

    monkeypatch.setattr(sharing_utils, "get_access_service", lambda: world.service)

    router = SessionStreamsRouter(
        service=AsyncMock(),
        interactions_service=AsyncMock(),
        run_admission=NoopRunAdmission(),
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
    ):
        await router.session_events(
            request=_request(world.project_id, user_id), session_id="session-1"
        )
    return captured["authorization_check"]


async def test_recheck_refuses_a_member_removed_after_connect(monkeypatch):
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
        check = await _open_stream(world, access, user, monkeypatch)

        assert await check() is True
        world.drop(user)
        assert await check() is False
    finally:
        reset_request_access(token)


async def test_recheck_refuses_an_api_key_deleted_after_connect(monkeypatch):
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
        check = await _open_stream(world, access, creator, monkeypatch)

        assert await check() is True
        del world.principals.records[key]
        assert await check() is False
    finally:
        reset_request_access(token)


async def test_recheck_in_a_copied_context_reads_fresh_state_and_keeps_the_memo(
    monkeypatch,
):
    """The streaming generator runs in a COPY of the request context: it shares the
    memo dict the connect-time check filled. A recheck there must ignore that dict,
    and leave it in place afterwards, also when the check raises or is cancelled."""

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
        check = await _open_stream(world, access, user, monkeypatch)
        memo = get_request_memo()
        # A connect-time answer in the shared memo, as a decision outside the fresh
        # memo would have left it.
        await world.service.check_request(
            access=access,
            action=Permission.VIEW_SESSIONS,
            project_id=world.project_id,
        )
        assert memo
        stale = dict(memo)

        world.drop(user)
        copied = contextvars.copy_context()

        async def _in_stream():
            allowed = await check()
            return allowed, get_request_memo()

        allowed, seen = await asyncio.create_task(_in_stream(), context=copied)
        assert allowed is False
        assert seen is memo
        assert memo == stale

        async def _raises():
            with fresh_request_memo():
                raise RuntimeError("boom")

        async def _cancelled():
            with fresh_request_memo():
                await asyncio.sleep(3600)

        task = asyncio.create_task(_raises(), context=copied)
        with pytest.raises(RuntimeError):
            await task
        assert copied.run(get_request_memo) is memo

        task = asyncio.create_task(_cancelled(), context=copied)
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert copied.run(get_request_memo) is memo
    finally:
        reset_request_access(token)
