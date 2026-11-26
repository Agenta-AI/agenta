from types import SimpleNamespace

from oss.src.services import organization_service


async def test_invite_link_opens_the_mobile_sign_in(monkeypatch):
    monkeypatch.setattr(
        organization_service,
        "env",
        SimpleNamespace(
            agenta=SimpleNamespace(web_url="https://app.example.com"),
            smtp=SimpleNamespace(enabled=False),
            sendgrid=SimpleNamespace(enabled=False),
        ),
    )

    link = await organization_service.send_invitation_email(
        email="a+b@example.com",
        token="to/ken",
        project_id="p1",
        workspace_id="w1",
        organization_id="o1",
        user=SimpleNamespace(username="owner"),
    )

    assert link == (
        "https://app.example.com/m/auth"
        "?token=to%2Fken"
        "&email=a%2Bb%40example.com"
        "&organization_id=o1"
        "&workspace_id=w1"
        "&project_id=p1"
    )
