"""Issue #5911: a connection whose handshake never completed must resume, not duplicate.

An api-key or OAuth row is persisted ``is_valid: False`` and only the provider callback flips
it. When that callback never lands, the row is stranded: discovery reports the integration as
not-ready, the agent asks to connect again, and the next slug in the ladder mints a SECOND row
while the first stays unusable forever. ``initiate_connection`` now re-drives the stranded row
in place, which is also what lets discovery propose its slug again.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from oss.src.core.gateway.connections import service as connections_service_mod
from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
    ConnectionProviderKind,
    ConnectionResponse,
)
from oss.src.core.gateway.connections.exceptions import ConnectionNotFoundError
from oss.src.core.gateway.connections.service import ConnectionsService


class _Adapter:
    def __init__(self):
        self.calls = 0

    async def initiate_connection(self, *, request):
        self.calls += 1
        return ConnectionResponse(
            provider_connection_id="acc_new",
            redirect_url="https://composio/redirect/new",
            connection_data={
                "connected_account_id": "acc_new",
                "auth_config_id": "ac_new",
                "redirect_url": "https://composio/redirect/new",
            },
        )


class _Dao:
    def __init__(self, rows: list[Connection], *, update_returns_row: bool = True):
        self.rows = rows
        self.created: list[ConnectionCreate] = []
        self.updated: list[dict] = []
        self.update_returns_row = update_returns_row

    async def query_connections(self, **_kwargs):
        return self.rows

    async def create_connection(self, *, project_id, user_id, connection_create):
        self.created.append(connection_create)
        return connection_create

    async def update_connection(self, *, project_id, connection_id, **kwargs):
        self.updated.append({"connection_id": connection_id, **kwargs})
        if not self.update_returns_row:
            return None
        row = next(r for r in self.rows if r.id == connection_id)
        merged = {**(row.data or {}), **(kwargs.get("data_update") or {})}
        return row.model_copy(update={"data": merged})


class _FakeEnv:
    class agenta:
        crypt_key = "x" * 32
        api_url = "http://test"


def _row(*, slug="telegram-main", is_active=True, is_valid=False) -> Connection:
    return Connection(
        id=uuid4(),
        slug=slug,
        provider_key=ConnectionProviderKind.COMPOSIO,
        integration_key="telegram",
        data={
            "connected_account_id": "acc_old",
            "redirect_url": "https://composio/redirect/old",
            "project_id": str(uuid4()),
        },
        flags={"is_active": is_active, "is_valid": is_valid},
    )


def _service(monkeypatch, dao: _Dao, adapter: _Adapter) -> ConnectionsService:
    service = object.__new__(ConnectionsService)
    service.connections_dao = dao

    class _Registry:
        def get(self, _key):
            return adapter

    service.adapter_registry = _Registry()
    monkeypatch.setattr(connections_service_mod, "env", _FakeEnv)
    monkeypatch.setattr(
        connections_service_mod, "make_oauth_state", lambda **_: "state"
    )
    return service


def _create(slug="telegram-main") -> ConnectionCreate:
    return ConnectionCreate(
        slug=slug,
        provider_key=ConnectionProviderKind.COMPOSIO,
        integration_key="telegram",
    )


async def test_stranded_row_resumes_in_place(monkeypatch):
    row = _row()
    dao = _Dao([row])
    adapter = _Adapter()
    service = _service(monkeypatch, dao, adapter)

    result = await service.initiate_connection(
        project_id=uuid4(), user_id=uuid4(), connection_create=_create()
    )

    assert dao.created == []  # no second row for the same slug
    assert len(dao.updated) == 1
    assert dao.updated[0]["connection_id"] == row.id
    assert dao.updated[0]["is_active"] is True
    assert dao.updated[0]["is_valid"] is False  # still pending its callback
    # The caller drives the FRESH redirect; the previous attempt's dead link must not survive.
    assert result.data["redirect_url"] == "https://composio/redirect/new"
    assert result.data["connected_account_id"] == "acc_new"


async def test_a_valid_row_is_left_alone_so_the_slug_conflict_still_fires(monkeypatch):
    """A usable connection under that slug is real — Settings needs the 409 to name a second
    account, and discovery ladders past it rather than sending anyone here."""
    dao = _Dao([_row(is_valid=True)])
    adapter = _Adapter()
    service = _service(monkeypatch, dao, adapter)

    await service.initiate_connection(
        project_id=uuid4(), user_id=uuid4(), connection_create=_create()
    )

    assert dao.updated == []
    assert len(dao.created) == 1


async def test_an_inactive_row_is_not_revived(monkeypatch):
    """It was switched off deliberately; refresh_connection refuses these too."""
    dao = _Dao([_row(is_active=False)])
    adapter = _Adapter()
    service = _service(monkeypatch, dao, adapter)

    await service.initiate_connection(
        project_id=uuid4(), user_id=uuid4(), connection_create=_create()
    )

    assert dao.updated == []
    assert len(dao.created) == 1


async def test_a_different_slug_still_creates(monkeypatch):
    """Resuming is per-slug: a second account under a new slug is an ordinary create."""
    dao = _Dao([_row()])
    adapter = _Adapter()
    service = _service(monkeypatch, dao, adapter)

    await service.initiate_connection(
        project_id=uuid4(),
        user_id=uuid4(),
        connection_create=_create(slug="telegram-second"),
    )

    assert dao.updated == []
    assert len(dao.created) == 1


async def test_a_lost_row_is_reported_not_returned_without_a_redirect(monkeypatch):
    """update_connection swallows its errors and returns None. Returning the stale row would
    hand the caller a connection with no redirect_url, which reads as 'no flow needed'."""
    dao = _Dao([_row()], update_returns_row=False)
    adapter = _Adapter()
    service = _service(monkeypatch, dao, adapter)

    with pytest.raises(ConnectionNotFoundError):
        await service.initiate_connection(
            project_id=uuid4(), user_id=uuid4(), connection_create=_create()
        )
