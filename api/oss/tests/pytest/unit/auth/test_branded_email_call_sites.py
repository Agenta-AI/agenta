from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from oss.src.core.emails import templates
from oss.src.services import organization_service, user_service
from oss.src.utils.env import env


def _enable_mailer(monkeypatch):
    monkeypatch.setattr(env.smtp, "host", "smtp.example.com")
    monkeypatch.setattr(env.smtp, "port", 587)
    monkeypatch.setattr(env.smtp, "from_email", "smtp@example.com")


@pytest.mark.asyncio
@pytest.mark.parametrize("sent", [True, False])
async def test_invitation_returns_the_send_result(monkeypatch, sent):
    _enable_mailer(monkeypatch)
    monkeypatch.setattr(
        organization_service.db_manager,
        "get_organization",
        AsyncMock(return_value=SimpleNamespace(name="Acme")),
    )
    send = AsyncMock(return_value=sent)
    monkeypatch.setattr(organization_service, "send_branded_email", send)

    result = await organization_service.send_invitation_email(
        "eve@acme.com",
        "token",
        project_id="p",
        workspace_id="w",
        organization_id="00000000-0000-0000-0000-000000000001",
        user=SimpleNamespace(username="Mahmoud"),
    )

    assert result is sent
    assert (
        send.await_args.kwargs["email"].subject
        == "Mahmoud invited you to Acme on Agenta"
    )


@pytest.mark.asyncio
async def test_member_joined_tolerates_a_missing_organization(monkeypatch):
    db = organization_service.db_manager
    monkeypatch.setattr(db, "get_organization", AsyncMock(return_value=None))
    monkeypatch.setattr(
        db, "get_project_by_workspace", AsyncMock(return_value=SimpleNamespace(id="p"))
    )
    monkeypatch.setattr(
        db,
        "get_workspace_administrators",
        AsyncMock(return_value=[SimpleNamespace(email="admin@acme.com")]),
    )
    send = AsyncMock(return_value=True)
    monkeypatch.setattr(organization_service, "send_branded_email", send)

    await organization_service.notify_org_admin_invitation(
        SimpleNamespace(id="w", organization_id="o"),
        SimpleNamespace(username="Ada", email="ada@acme.com"),
    )

    assert send.await_args.kwargs["to_email"] == "admin@acme.com"
    assert send.await_args.kwargs["email"].subject == "Ada joined your organization"


@pytest.mark.asyncio
async def test_password_reset_sends_the_branded_email(monkeypatch):
    _enable_mailer(monkeypatch)
    users = {
        "u": SimpleNamespace(uid="1", email="you@acme.com"),
        "a": SimpleNamespace(uid="2", email="admin@acme.com", username="Mahmoud"),
    }
    monkeypatch.setattr(
        user_service.db_manager,
        "get_user_with_id",
        AsyncMock(side_effect=lambda user_id: users[user_id]),
    )
    monkeypatch.setattr(
        user_service,
        "create_reset_password_link",
        AsyncMock(return_value="https://x.test/reset?token=t"),
    )
    send = AsyncMock(return_value=True)
    monkeypatch.setattr(user_service, "send_branded_email", send)

    await user_service.generate_user_password_reset_link(user_id="u", admin_user_id="a")

    email = send.await_args.kwargs["email"]
    assert send.await_args.kwargs["to_email"] == "you@acme.com"
    assert email.subject == "Reset your Agenta password"
    assert 'href="https://x.test/reset?token=t"' in email.html


def test_subject_drops_line_breaks_from_names():
    rendered = templates.render_invitation_email(
        inviter="Eve", organization="Acme\r\nBcc: x@y.z", url="https://x.test"
    )

    assert "\n" not in rendered.subject and "\r" not in rendered.subject
