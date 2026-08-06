from oss.src.services import commoners


def test_can_create_organization_allows_anyone_when_unset(monkeypatch):
    monkeypatch.setattr(
        commoners.env.agenta.access, "allowed_owner_emails", None, raising=False
    )

    assert commoners.can_create_organization("anyone@example.com") is True


def test_can_create_organization_allows_listed_email(monkeypatch):
    monkeypatch.setattr(
        commoners.env.agenta.access,
        "allowed_owner_emails",
        {"owner@example.com"},
        raising=False,
    )

    assert commoners.can_create_organization("owner@example.com") is True
    assert commoners.can_create_organization("  Owner@Example.com ") is True


def test_can_create_organization_rejects_unlisted_email(monkeypatch):
    monkeypatch.setattr(
        commoners.env.agenta.access,
        "allowed_owner_emails",
        {"owner@example.com"},
        raising=False,
    )

    assert commoners.can_create_organization("other@example.com") is False
