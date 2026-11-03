"""A password reset link is made only for a member of the caller's project."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from oss.src.routers import user_profile


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(user_id=str(uuid4()), project_id=str(uuid4()))
    )


@pytest.fixture
def wiring(monkeypatch):
    monkeypatch.setattr(
        user_profile, "check_action_access", AsyncMock(return_value=True)
    )
    link = AsyncMock(return_value="https://example.test/reset")
    monkeypatch.setattr(
        user_profile.user_service, "generate_user_password_reset_link", link
    )
    project = SimpleNamespace(organization_id=uuid4())
    monkeypatch.setattr(
        user_profile.db_manager, "get_project_by_id", AsyncMock(return_value=project)
    )
    monkeypatch.setattr(
        user_profile.db_manager,
        "get_organization_owner",
        AsyncMock(return_value=SimpleNamespace(id=uuid4())),
    )
    return link


def _members(monkeypatch, is_member):
    """The membership resolver's answer for the target user in the caller's project."""
    service = SimpleNamespace(is_member=is_member)
    monkeypatch.setattr(user_profile, "get_memberships_service", lambda: service)
    return service


@pytest.mark.asyncio
async def test_reset_is_refused_for_a_user_outside_the_project(monkeypatch, wiring):
    # The resolver answers no for a user without a row and for a removed member.
    _members(monkeypatch, AsyncMock(return_value=False))

    response = await user_profile.reset_user_password(_request(), user_id=str(uuid4()))

    assert response.status_code == 404
    wiring.assert_not_awaited()


@pytest.mark.asyncio
async def test_reset_is_refused_for_a_malformed_user_id(monkeypatch, wiring):
    service = _members(monkeypatch, AsyncMock(return_value=True))

    response = await user_profile.reset_user_password(_request(), user_id="nope")

    assert response.status_code == 404
    service.is_member.assert_not_awaited()
    wiring.assert_not_awaited()


@pytest.mark.asyncio
async def test_reset_link_is_made_for_a_project_member(monkeypatch, wiring):
    service = _members(monkeypatch, AsyncMock(return_value=True))
    request = _request()
    user_id = str(uuid4())

    result = await user_profile.reset_user_password(request, user_id=user_id)

    assert result == "https://example.test/reset"
    assert wiring.await_args.kwargs["user_id"] == user_id
    assert service.is_member.await_args.kwargs == {
        "user_id": UUID(user_id),
        "project_id": UUID(request.state.project_id),
    }
