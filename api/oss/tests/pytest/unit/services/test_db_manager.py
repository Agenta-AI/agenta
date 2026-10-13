from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.exc import NoResultFound

from oss.src.services import db_manager


class _ScalarsResult:
    def __init__(self, memberships):
        self._memberships = memberships

    def all(self):
        return self._memberships

    def first(self):
        return self._memberships[0] if self._memberships else None


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
    mock_engine = type(
        "MockEngine", (), {"session": lambda self: _SessionContext(memberships)}
    )()
    monkeypatch.setattr(
        db_manager,
        "get_transactions_engine",
        lambda: mock_engine,
    )


@pytest.mark.asyncio
async def test_get_default_workspace_id_ignores_owner_role(monkeypatch):
    # Owner-role is NOT preferred: under multi-org an invitee owns their own
    # empty personal workspace, so the oldest membership wins regardless of role.
    owner_workspace_id = uuid4()
    editor_workspace_id = uuid4()

    _patch_core_session(
        monkeypatch,
        [
            SimpleNamespace(
                workspace_id=editor_workspace_id,
                role="editor",
                created_at=datetime(2026, 4, 9, tzinfo=timezone.utc),
            ),
            SimpleNamespace(
                workspace_id=owner_workspace_id,
                role="owner",
                created_at=datetime(2026, 4, 10, tzinfo=timezone.utc),
            ),
        ],
    )

    workspace_id = await db_manager.get_default_workspace_id(str(uuid4()))

    assert workspace_id == str(editor_workspace_id)


@pytest.mark.asyncio
async def test_get_default_workspace_id_falls_back_to_oldest_membership(monkeypatch):
    oldest_workspace_id = uuid4()
    newer_workspace_id = uuid4()

    _patch_core_session(
        monkeypatch,
        [
            SimpleNamespace(
                workspace_id=newer_workspace_id,
                role="editor",
                created_at=datetime(2026, 4, 10, tzinfo=timezone.utc),
            ),
            SimpleNamespace(
                workspace_id=oldest_workspace_id,
                role="viewer",
                created_at=datetime(2026, 4, 9, tzinfo=timezone.utc),
            ),
        ],
    )

    workspace_id = await db_manager.get_default_workspace_id(str(uuid4()))

    assert workspace_id == str(oldest_workspace_id)


@pytest.mark.asyncio
async def test_get_default_workspace_id_raises_when_user_has_no_memberships(
    monkeypatch,
):
    _patch_core_session(monkeypatch, [])

    with pytest.raises(NoResultFound, match="No workspace membership found"):
        await db_manager.get_default_workspace_id(str(uuid4()))


class _CapturingSession:
    """Records the statement so a test can assert what was filtered on."""

    def __init__(self, rows, captured):
        self._rows = rows
        self._captured = captured

    async def execute(self, query):
        self._captured.append(query)
        return _ExecuteResult(self._rows)


class _CapturingSessionContext:
    def __init__(self, rows, captured):
        self._rows = rows
        self._captured = captured

    async def __aenter__(self):
        return _CapturingSession(self._rows, self._captured)

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_capturing_session(monkeypatch, rows):
    captured = []
    mock_engine = type(
        "MockEngine",
        (),
        {"session": lambda self: _CapturingSessionContext(rows, captured)},
    )()
    monkeypatch.setattr(db_manager, "get_transactions_engine", lambda: mock_engine)
    return captured


@pytest.mark.asyncio
async def test_get_project_member_filters_on_both_project_and_user(monkeypatch):
    # The pair is what the (user_id, project_id) index serves. Filtering on the
    # project alone is the sequential scan this function replaced.
    captured = _patch_capturing_session(monkeypatch, [SimpleNamespace(role="viewer")])

    await db_manager.get_project_member(
        project_id=str(uuid4()),
        user_id=str(uuid4()),
    )

    where = str(captured[0].whereclause)
    assert "project_members.project_id" in where
    assert "project_members.user_id" in where


@pytest.mark.asyncio
async def test_get_project_member_returns_the_row(monkeypatch):
    member = SimpleNamespace(role="editor")
    _patch_capturing_session(monkeypatch, [member])

    found = await db_manager.get_project_member(
        project_id=str(uuid4()),
        user_id=str(uuid4()),
    )

    assert found is member


@pytest.mark.asyncio
async def test_get_project_member_returns_none_for_a_non_member(monkeypatch):
    _patch_capturing_session(monkeypatch, [])

    found = await db_manager.get_project_member(
        project_id=str(uuid4()),
        user_id=str(uuid4()),
    )

    assert found is None
