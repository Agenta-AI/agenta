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
    monkeypatch.setattr(
        db_manager_ee.engine,
        "core_session",
        lambda: _SessionContext(memberships),
    )


class _PendingInviteSession:
    def __init__(self, invitations):
        self._invitations = invitations
        self.deleted = []
        self.committed = False

    async def execute(self, _query):
        return _ExecuteResult(self._invitations)

    async def delete(self, item):
        self.deleted.append(item)

    async def commit(self):
        self.committed = True


class _PendingInviteSessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


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


@pytest.mark.asyncio
async def test_remove_user_from_workspace_deletes_pending_invitation_without_user(
    monkeypatch,
):
    workspace_id = uuid4()
    organization_id = uuid4()
    project_id = uuid4()
    invitation = SimpleNamespace(id=uuid4(), project_id=project_id, user_id=None)
    session = _PendingInviteSession([invitation])

    async def get_user_with_email(email):
        assert email == "pending@test.agenta.ai"
        return None

    async def get_workspace(workspace_id):
        return SimpleNamespace(id=workspace_id, organization_id=organization_id)

    async def fetch_projects_by_workspace(workspace_id):
        return [SimpleNamespace(id=project_id)]

    async def fail_if_nested_invitation_delete_is_used(invitation_id):
        raise AssertionError(f"unexpected nested invitation delete: {invitation_id}")

    monkeypatch.setattr(
        db_manager_ee.db_manager,
        "get_user_with_email",
        get_user_with_email,
    )
    monkeypatch.setattr(db_manager_ee.db_manager, "get_workspace", get_workspace)
    monkeypatch.setattr(
        db_manager_ee.db_manager,
        "fetch_projects_by_workspace",
        fetch_projects_by_workspace,
    )
    monkeypatch.setattr(
        db_manager_ee,
        "delete_invitation",
        fail_if_nested_invitation_delete_is_used,
    )
    monkeypatch.setattr(
        db_manager_ee.engine,
        "core_session",
        lambda: _PendingInviteSessionContext(session),
    )

    result = await db_manager_ee.remove_user_from_workspace(
        str(workspace_id),
        "pending@test.agenta.ai",
    )

    assert result is True
    assert session.deleted == [invitation]
    assert session.committed is True
