from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.services import db_manager


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

    monkeypatch.setattr(db_manager, "get_user_with_email", get_user_with_email)
    monkeypatch.setattr(db_manager, "get_workspace", get_workspace)
    monkeypatch.setattr(
        db_manager,
        "fetch_projects_by_workspace",
        fetch_projects_by_workspace,
    )
    mock_engine = type(
        "MockEngine",
        (),
        {"session": lambda self: _PendingInviteSessionContext(session)},
    )()
    monkeypatch.setattr(
        db_manager,
        "get_transactions_engine",
        lambda: mock_engine,
    )

    result = await db_manager.remove_user_from_workspace(
        str(workspace_id),
        "pending@test.agenta.ai",
    )

    assert result is True
    assert session.deleted == [invitation]
    assert session.committed is True
