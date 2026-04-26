from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.exc import NoResultFound

from ee.src.models.shared_models import WorkspaceRole
from ee.src.services import db_manager_ee


class _ScalarsResult:
    def __init__(self, memberships):
        self._memberships = memberships

    def all(self):
        return self._memberships


class _ExecuteResult:
    def __init__(self, memberships):
        self._memberships = memberships

    def scalars(self):
        return _ScalarsResult(self._memberships)


class _Session:
    def __init__(self, memberships):
        self._memberships = memberships

    async def execute(self, _query):
        return _ExecuteResult(self._memberships)


class _SessionContext:
    def __init__(self, memberships):
        self._memberships = memberships

    async def __aenter__(self):
        return _Session(self._memberships)

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_core_session(monkeypatch, memberships):
    # db_manager_ee calls get_transactions_engine() — patch where it's called
    mock_engine = type(
        "MockEngine", (), {"session": lambda self: _SessionContext(memberships)}
    )()
    monkeypatch.setattr(
        db_manager_ee,
        "get_transactions_engine",
        lambda: mock_engine,
    )


@pytest.mark.asyncio
async def test_get_default_workspace_id_prefers_owner_membership(monkeypatch):
    owner_workspace_id = uuid4()
    editor_workspace_id = uuid4()

    _patch_core_session(
        monkeypatch,
        [
            SimpleNamespace(
                workspace_id=editor_workspace_id,
                role=WorkspaceRole.EDITOR,
                created_at=datetime(2026, 4, 9, tzinfo=timezone.utc),
            ),
            SimpleNamespace(
                workspace_id=owner_workspace_id,
                role=WorkspaceRole.OWNER,
                created_at=datetime(2026, 4, 10, tzinfo=timezone.utc),
            ),
        ],
    )

    workspace_id = await db_manager_ee.get_default_workspace_id(str(uuid4()))

    assert workspace_id == str(owner_workspace_id)


@pytest.mark.asyncio
async def test_get_default_workspace_id_falls_back_to_oldest_membership(monkeypatch):
    oldest_workspace_id = uuid4()
    newer_workspace_id = uuid4()

    _patch_core_session(
        monkeypatch,
        [
            SimpleNamespace(
                workspace_id=newer_workspace_id,
                role=WorkspaceRole.EDITOR,
                created_at=datetime(2026, 4, 10, tzinfo=timezone.utc),
            ),
            SimpleNamespace(
                workspace_id=oldest_workspace_id,
                role=WorkspaceRole.VIEWER,
                created_at=datetime(2026, 4, 9, tzinfo=timezone.utc),
            ),
        ],
    )

    workspace_id = await db_manager_ee.get_default_workspace_id(str(uuid4()))

    assert workspace_id == str(oldest_workspace_id)


@pytest.mark.asyncio
async def test_get_default_workspace_id_raises_when_user_has_no_memberships(
    monkeypatch,
):
    _patch_core_session(monkeypatch, [])

    with pytest.raises(NoResultFound, match="No workspace membership found"):
        await db_manager_ee.get_default_workspace_id(str(uuid4()))
