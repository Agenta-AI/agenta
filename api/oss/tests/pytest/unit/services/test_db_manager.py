from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.services import db_manager


# ---------------------------------------------------------------------------
# admin_create_organization -- flags regression (issue #5791)
# ---------------------------------------------------------------------------


class _WriteCapturingSession:
    """Session stub that captures the object passed to .add()."""

    def __init__(self):
        self.added = None

    def add(self, obj):
        self.added = obj

    async def commit(self):
        pass

    async def refresh(self, obj):
        pass


class _WriteCapturingSessionContext:
    def __init__(self):
        self.session = _WriteCapturingSession()

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_write_session(monkeypatch):
    ctx = _WriteCapturingSessionContext()
    mock_engine = type("MockEngine", (), {"session": lambda self: ctx})()
    monkeypatch.setattr(db_manager, "get_transactions_engine", lambda: mock_engine)
    return ctx


def _patch_auth(monkeypatch, *, email_enabled: bool = True, oidc_enabled: bool = False):
    """Replace db_manager.env with a lightweight stub to control auth flags.

    email_enabled/oidc_enabled are @property methods on AuthFacade, so we
    can't patch them directly; replacing the module-level 'env' reference is
    the simplest isolation approach.
    """
    stub_env = SimpleNamespace(
        auth=SimpleNamespace(email_enabled=email_enabled, oidc_enabled=oidc_enabled)
    )
    monkeypatch.setattr(db_manager, "env", stub_env)


@pytest.mark.asyncio
async def test_admin_create_organization_includes_allow_email_flag(monkeypatch):
    """admin_create_organization must write allow_email so the web UI lets
    the user log in (filterOrgsByAuthMethod requires this flag -- issue #5791)."""
    ctx = _patch_write_session(monkeypatch)
    _patch_auth(monkeypatch, email_enabled=True, oidc_enabled=False)

    owner_id = uuid4()
    await db_manager.admin_create_organization(
        name="test-org", slug=None, owner_id=owner_id
    )

    flags = ctx.session.added.flags
    assert "allow_email" in flags, "allow_email missing from admin-minted org flags"
    assert flags["allow_email"] is True


@pytest.mark.asyncio
async def test_admin_create_organization_flags_mirror_create_organization(monkeypatch):
    """Flags produced by admin_create_organization must contain the same keys
    as those written by the normal signup path (create_organization)."""
    ctx = _patch_write_session(monkeypatch)
    _patch_auth(monkeypatch, email_enabled=True, oidc_enabled=False)

    owner_id = uuid4()
    await db_manager.admin_create_organization(
        name="test-org", slug=None, owner_id=owner_id
    )

    flags = ctx.session.added.flags
    expected_keys = {
        "is_demo",
        "allow_email",
        "allow_social",
        "allow_sso",
        "allow_root",
        "domains_only",
        "auto_join",
    }
    assert expected_keys == set(flags.keys())
