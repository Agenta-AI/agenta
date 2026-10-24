from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import NoResultFound

import oss.src.routers.organization_router as organization_router
import oss.src.services.db_manager as db_manager


class _Result:
    def __init__(self, row):
        self._row = row

    def scalars(self):
        return self

    def first(self):
        return self._row


class _Engine:
    """Fake engine whose session answers one lookup per execute call."""

    def __init__(self, rows):
        self.executed = []
        self._rows = list(rows)

    def session(self):
        engine = self

        class _Session:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def execute(self, statement):
                engine.executed.append(str(statement.compile()))
                return _Result(engine._rows.pop(0))

        return _Session()


@pytest.mark.asyncio
async def test_workspace_creation_looks_the_user_up_by_internal_id(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    organization = SimpleNamespace(id=uuid4())
    engine = _Engine([user, organization])
    monkeypatch.setattr(db_manager, "get_transactions_engine", lambda: engine)
    create = AsyncMock(return_value="workspace_db")
    monkeypatch.setattr(db_manager, "create_workspace_db_object", create)
    monkeypatch.setattr(
        db_manager, "get_workspace_in_format", AsyncMock(return_value="done")
    )

    result = await db_manager.create_workspace_with_defaults(
        SimpleNamespace(name="x"), str(organization.id), str(user.id)
    )

    assert result == "done"
    assert "WHERE users.id =" in engine.executed[0]
    assert create.await_args.args[3] is user


@pytest.mark.asyncio
async def test_workspace_creation_for_unknown_user_raises_no_result(monkeypatch):
    engine = _Engine([None])
    monkeypatch.setattr(db_manager, "get_transactions_engine", lambda: engine)

    with pytest.raises(NoResultFound):
        await db_manager.create_workspace_with_defaults(
            SimpleNamespace(name="x"), str(uuid4()), str(uuid4())
        )


@pytest.mark.asyncio
async def test_route_answers_404_for_unknown_user(monkeypatch):
    monkeypatch.setattr(
        organization_router, "_check_org_owner", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(organization_router, "is_ee", lambda: False)
    monkeypatch.setattr(
        organization_router.organization_service,
        "create_new_workspace",
        AsyncMock(side_effect=NoResultFound("User with id x not found")),
    )
    request = MagicMock()
    request.state.user_id = str(uuid4())

    with pytest.raises(HTTPException) as raised:
        await organization_router.create_workspace(
            request=request,
            organization_id=str(uuid4()),
            payload=SimpleNamespace(name="Second"),
        )

    assert raised.value.status_code == 404
