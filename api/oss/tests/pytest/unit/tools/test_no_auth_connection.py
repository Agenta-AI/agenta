from __future__ import annotations

from uuid import uuid4

import pytest

from oss.src.core.gateway.connections import service as connections_service_mod
from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
    ConnectionProviderKind,
    ConnectionRequest,
    ConnectionResponse,
)
from oss.src.core.gateway.connections.providers.composio.adapter import (
    ComposioConnectionsAdapter,
    _is_no_auth_toolkit,
)
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.tools.dtos import (
    ToolConnection,
    ToolExecutionRequest,
    ToolProviderKind,
)
from oss.src.core.tools.exceptions import (
    ConnectionNotFoundError as ToolConnectionNotFoundError,
)
from oss.src.core.tools.providers.composio.adapter import ComposioToolsAdapter
from oss.src.core.tools.service import ToolsService


_NO_AUTH_TOOLKIT = {
    "slug": "codeinterpreter",
    "auth_config_details": [{"name": "CodeInterpreter", "mode": "NO_AUTH"}],
}
_OAUTH_TOOLKIT = {
    "slug": "github",
    "auth_config_details": [{"name": "GitHub", "mode": "OAUTH2"}],
}


# --- toolkit detection (gateway connections adapter) ------------------------ #


def test_is_no_auth_toolkit_detects_no_auth():
    assert _is_no_auth_toolkit(_NO_AUTH_TOOLKIT) is True
    assert _is_no_auth_toolkit(_OAUTH_TOOLKIT) is False
    assert _is_no_auth_toolkit({"auth_config_details": []}) is False
    assert _is_no_auth_toolkit({}) is False


def test_is_no_auth_toolkit_mixed_mode_is_authful():
    """A toolkit that mixes NO_AUTH with a real scheme must stay auth-backed."""
    mixed = {
        "slug": "x",
        "auth_config_details": [{"mode": "NO_AUTH"}, {"mode": "OAUTH2"}],
    }
    assert _is_no_auth_toolkit(mixed) is False


async def test_initiate_connection_skips_auth_config_for_no_auth(monkeypatch):
    """No-auth toolkit must not POST /auth_configs (Composio rejects that with 400)."""
    adapter = object.__new__(ComposioConnectionsAdapter)

    posted: list[str] = []

    async def _get(path, *, params=None):
        assert path == "/toolkits/codeinterpreter"
        return _NO_AUTH_TOOLKIT

    async def _post(path, *, json=None):
        posted.append(path)
        return {}

    monkeypatch.setattr(adapter, "_get", _get)
    monkeypatch.setattr(adapter, "_post", _post)

    result = await adapter.initiate_connection(
        request=ConnectionRequest(
            user_id="proj",
            integration_key="codeinterpreter",
        ),
    )

    assert posted == []  # no /auth_configs, no /connected_accounts/link
    assert result.provider_connection_id == ""
    assert result.redirect_url is None
    assert result.connection_data == {"no_auth": True}


# --- tool execution (tools adapter) ----------------------------------------- #


async def test_execute_omits_connected_account_for_no_auth(monkeypatch):
    """A blank provider_connection_id must not be sent as connected_account_id."""
    adapter = object.__new__(ComposioToolsAdapter)

    sent: dict = {}

    async def _post(path, *, json=None):
        sent["path"] = path
        sent["json"] = json
        return {"data": {"stdout": "42\n"}, "successful": True, "error": None}

    monkeypatch.setattr(adapter, "_post", _post)

    await adapter.execute(
        request=ToolExecutionRequest(
            integration_key="codeinterpreter",
            action_key="EXECUTE_CODE",
            provider_connection_id=None,
            arguments={"code_to_execute": "print(6*7)"},
        ),
    )

    assert sent["path"] == "/tools/execute/CODEINTERPRETER_EXECUTE_CODE"
    assert "connected_account_id" not in sent["json"]
    assert sent["json"]["arguments"] == {"code_to_execute": "print(6*7)"}


async def test_execute_sends_connected_account_when_present(monkeypatch):
    """Auth regression: a real provider connection id is still sent as connected_account_id."""
    adapter = object.__new__(ComposioToolsAdapter)
    sent: dict = {}

    async def _post(path, *, json=None):
        sent["json"] = json
        return {"data": {"login": "ok"}, "successful": True, "error": None}

    monkeypatch.setattr(adapter, "_post", _post)

    await adapter.execute(
        request=ToolExecutionRequest(
            integration_key="github",
            action_key="GET_THE_AUTHENTICATED_USER",
            provider_connection_id="acc_123",
            arguments={},
        ),
    )
    assert sent["json"]["connected_account_id"] == "acc_123"


# --- connection flags + helpers --------------------------------------------- #


def _no_auth_connection() -> ToolConnection:
    return ToolConnection(
        id=uuid4(),
        slug="qa-codeinterp",
        provider_key=ToolProviderKind.COMPOSIO,
        integration_key="codeinterpreter",
        data={"no_auth": True, "project_id": str(uuid4())},
        flags={"is_active": True, "is_valid": True},
    )


def test_no_auth_connection_flags_and_helpers():
    conn = _no_auth_connection()
    assert conn.has_auth is False
    assert conn.is_active is True
    assert conn.is_valid is True
    assert conn.provider_connection_id is None


# --- resolution (ToolsService.resolve_connection_by_slug) ------------------- #


async def test_resolve_connection_by_slug_accepts_no_auth(monkeypatch):
    """A no-auth connection resolves despite having no provider_connection_id."""
    service = object.__new__(ToolsService)
    conn = _no_auth_connection()

    async def _query(**_kwargs):
        return [conn]

    monkeypatch.setattr(service, "query_connections", _query)

    resolved = await service.resolve_connection_by_slug(
        project_id=uuid4(),
        provider_key="composio",
        integration_key="codeinterpreter",
        connection_slug="qa-codeinterp",
    )
    assert resolved is conn


async def test_resolve_connection_by_slug_rejects_authful_without_provider_id(
    monkeypatch,
):
    """An auth toolkit with no provider connection id still fails (regression guard)."""
    service = object.__new__(ToolsService)
    conn = ToolConnection(
        id=uuid4(),
        slug="gh",
        provider_key=ToolProviderKind.COMPOSIO,
        integration_key="github",
        data={"project_id": str(uuid4())},
        flags={"is_active": True, "is_valid": True},
    )

    async def _query(**_kwargs):
        return [conn]

    monkeypatch.setattr(service, "query_connections", _query)

    with pytest.raises(ToolConnectionNotFoundError):
        await service.resolve_connection_by_slug(
            project_id=uuid4(),
            provider_key="composio",
            integration_key="github",
            connection_slug="gh",
        )


# --- server-owned flags on create (gateway ConnectionsService) -------------- #


async def _capture_created_flags(
    monkeypatch, *, no_auth: bool, client_flags: dict
) -> dict:
    """Run create_connection with a faked provider + DAO; return persisted flags/data."""
    service = object.__new__(ConnectionsService)
    captured: dict = {}

    class _Adapter:
        async def initiate_connection(self, *, request):
            if no_auth:
                return ConnectionResponse(
                    provider_connection_id="",
                    redirect_url=None,
                    connection_data={"no_auth": True},
                )
            return ConnectionResponse(
                provider_connection_id="acc_pending",
                redirect_url="https://composio/redirect",
                connection_data={"connected_account_id": "acc_pending"},
            )

    class _Registry:
        def get(self, _key):
            return _Adapter()

    class _Dao:
        async def create_connection(self, *, project_id, user_id, connection_create):
            captured["flags"] = dict(connection_create.flags or {})
            captured["data"] = dict(connection_create.data or {})
            return connection_create

    class _FakeEnv:
        class agenta:
            crypt_key = "x" * 32
            api_url = "http://test"

    service.adapter_registry = _Registry()
    service.connections_dao = _Dao()
    monkeypatch.setattr(connections_service_mod, "env", _FakeEnv)
    monkeypatch.setattr(
        connections_service_mod, "make_oauth_state", lambda **_: "state"
    )

    cc = ConnectionCreate(
        slug="c1",
        provider_key=ConnectionProviderKind.COMPOSIO,
        integration_key="codeinterpreter" if no_auth else "github",
        flags=client_flags,
    )
    await service.initiate_connection(
        project_id=uuid4(), user_id=uuid4(), connection_create=cc
    )
    return captured


async def test_create_connection_overrides_client_flags_for_auth_toolkit(monkeypatch):
    """A client cannot mark an auth-backed connection valid before its flow completes."""
    captured = await _capture_created_flags(
        monkeypatch, no_auth=False, client_flags={"is_valid": True, "is_active": True}
    )
    assert captured["flags"]["is_valid"] is False
    assert captured["flags"]["is_active"] is True


async def test_create_connection_marks_no_auth_valid(monkeypatch):
    """A no-auth connection is server-marked valid up front (no flow to wait for)."""
    captured = await _capture_created_flags(monkeypatch, no_auth=True, client_flags={})
    assert captured["flags"]["is_valid"] is True
    assert captured["flags"]["is_active"] is True
    assert captured["data"].get("no_auth") is True


# --- refresh no-op for no-auth (gateway ConnectionsService) ----------------- #


async def test_refresh_connection_no_auth_is_noop():
    """Refreshing a no-auth connection is a no-op, not a not-found error."""
    service = object.__new__(ConnectionsService)
    conn = _no_auth_connection_gw()

    class _Dao:
        async def get_connection(self, *, project_id, connection_id):
            return conn

    service.connections_dao = _Dao()

    out = await service.refresh_connection(project_id=uuid4(), connection_id=conn.id)
    assert out is conn


def _no_auth_connection_gw() -> Connection:
    return Connection(
        id=uuid4(),
        slug="qa-codeinterp",
        provider_key=ConnectionProviderKind.COMPOSIO,
        integration_key="codeinterpreter",
        data={"no_auth": True, "project_id": str(uuid4())},
        flags={"is_active": True, "is_valid": True},
    )
