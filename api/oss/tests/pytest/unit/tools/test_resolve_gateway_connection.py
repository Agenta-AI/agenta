"""``POST /tools/resolve`` answers a ``gateway_connection`` entry with a catalog slice.

The entry names one whole integration, so resolution validates the connection exactly as
the per-tool arm does and returns the integration's tool keys with their ``read_only``
hint, and nothing about policy: the SDK compiles the authored policy itself. Legacy
per-tool entries keep answering in ``custom``, in the same request (qa.md case G11).
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Optional
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.tools.models import ToolResolveRequest
from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.tools import service as service_module
from oss.src.core.tools.dtos import (
    ToolCatalogAction,
    ToolCatalogActionDetails,
)
from oss.src.core.tools.exceptions import (
    ConnectionInactiveError,
    ConnectionInvalidError,
    ConnectionNotFoundError,
)
from oss.src.core.tools.service import ToolsService


CONNECTION_ENTRY = {
    "type": "gateway_connection",
    "connection": {
        "provider": "composio",
        "integration": "github",
        "slug": "github-work",
    },
    "policy": {
        "permissions": {
            "default": "deny",
            "tools": {"GET_ISSUE": "inherit", "CREATE_ISSUE": "ask"},
        }
    },
}

LEGACY_ENTRY = {
    "type": "gateway",
    "integration": "github",
    "action": "GET_ISSUE",
    "connection": "github-work",
}

CATALOG = [
    ToolCatalogAction(
        key="GET_ISSUE",
        name="Get issue",
        provider_action_id="GITHUB_GET_ISSUE",
        read_only=True,
        input_schema={"type": "object", "properties": {"number": {"type": "integer"}}},
    ),
    ToolCatalogAction(
        key="CREATE_ISSUE",
        name="Create issue",
        provider_action_id="GITHUB_CREATE_ISSUE",
        read_only=False,
        input_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    ),
    # No hint at all: unknown must survive as unknown, never be guessed into a boolean.
    ToolCatalogAction(
        key="LIST_LABELS",
        name="List labels",
        provider_action_id="GITHUB_LIST_LABELS",
        input_schema={"type": "object", "properties": {}},
    ),
]


class FakeProvider:
    async def resolve_toolkit_version(self, *, integration_key: str, version: str):
        assert integration_key == "github"
        assert version == "latest"
        return "20250827_00"

    async def list_all_actions(
        self, *, integration_key: str, toolkit_version: Optional[str] = None
    ):
        assert toolkit_version in {None, "20250827_00"}
        return CATALOG

    async def get_action(
        self,
        *,
        action_key: str,
        provider_action_id: str,
        toolkit_version: Optional[str] = None,
    ):
        return ToolCatalogActionDetails(
            key=action_key,
            name=action_key,
            provider_action_id=provider_action_id,
            description="Get one issue",
        )


def _router(
    monkeypatch,
    *,
    connection_error: Optional[Exception] = None,
    connection_calls: Optional[list] = None,
) -> ToolsRouter:
    service = object.__new__(ToolsService)
    service.adapter_registry = SimpleNamespace(get=lambda _key: FakeProvider())

    async def _connection(**kwargs):
        if connection_calls is not None:
            connection_calls.append(kwargs)
        if connection_error is not None:
            raise connection_error
        return SimpleNamespace(provider_connection_id="acc_1", data={})

    monkeypatch.setattr(service, "resolve_connection_by_slug", _connection)

    async def _get_cache(**_kwargs):
        return None

    async def _set_cache(**_kwargs):
        return None

    monkeypatch.setattr(service_module, "get_cache", _get_cache)
    monkeypatch.setattr(service_module, "set_cache", _set_cache)

    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)

    return ToolsRouter(tools_service=service)


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4())),
        headers={},
    )


async def test_a_connection_entry_returns_the_catalog_slice(monkeypatch):
    connection_calls: list = []
    request = _request()
    response = await _router(
        monkeypatch, connection_calls=connection_calls
    ).resolve_tools(
        request,
        body=ToolResolveRequest(tools=[CONNECTION_ENTRY]),
    )

    # The connection is validated exactly as the per-tool arm validates one, with the
    # routing fields of the entry and the project the caller is scoped to.
    assert connection_calls == [
        {
            "project_id": UUID(request.state.project_id),
            "provider_key": "composio",
            "integration_key": "github",
            "connection_slug": "github-work",
        }
    ]

    assert response.custom == []
    assert len(response.gateway_connections) == 1

    resolved = response.gateway_connections[0]
    assert resolved.provider == "composio"
    assert resolved.integration == "github"
    assert resolved.connection == "github-work"
    assert resolved.toolkit_version == "20250827_00"
    assert [(t.key, t.read_only) for t in resolved.tools] == [
        ("GET_ISSUE", True),
        ("CREATE_ISSUE", False),
        ("LIST_LABELS", None),
    ]
    assert resolved.tools[0].input_schema == CATALOG[0].input_schema


async def test_the_slice_carries_no_policy(monkeypatch):
    """The compiler needs a key and a read-only hint. Permission stays SDK-side."""
    response = await _router(monkeypatch).resolve_tools(
        _request(),
        body=ToolResolveRequest(tools=[CONNECTION_ENTRY]),
    )

    tool = response.gateway_connections[0].tools[0]
    assert set(tool.model_dump().keys()) == {"key", "read_only", "input_schema"}


async def test_a_missing_connection_is_a_404(monkeypatch):
    router = _router(
        monkeypatch,
        connection_error=ConnectionNotFoundError(
            provider_key="composio",
            integration_key="github",
            connection_slug="github-work",
        ),
    )

    with pytest.raises(HTTPException) as caught:
        await router.resolve_tools(
            _request(),
            body=ToolResolveRequest(tools=[CONNECTION_ENTRY]),
        )

    assert caught.value.status_code == 404


@pytest.mark.parametrize(
    "connection_error",
    [
        ConnectionInactiveError(connection_id="github-work"),
        ConnectionInvalidError(connection_slug="github-work"),
    ],
)
async def test_an_unusable_connection_is_a_400(monkeypatch, connection_error):
    router = _router(monkeypatch, connection_error=connection_error)

    with pytest.raises(HTTPException) as caught:
        await router.resolve_tools(
            _request(),
            body=ToolResolveRequest(tools=[CONNECTION_ENTRY]),
        )

    assert caught.value.status_code == 400


async def test_a_mixed_request_answers_both_arms(monkeypatch):
    """G11: a revision may hold both formats while a project migrates."""
    response = await _router(monkeypatch).resolve_tools(
        _request(),
        body=ToolResolveRequest(tools=["read", LEGACY_ENTRY, CONNECTION_ENTRY]),
    )

    assert response.builtins == ["read"]
    assert [t.call_ref for t in response.custom] == [
        "tools.composio.github.GET_ISSUE.github-work"
    ]
    assert response.gateway_connections[0].integration == "github"
    # ``count`` still counts model-ready tools only, so the connection group is not
    # added to it. Contracts section 3 shows count 0 beside one connection.
    assert response.count == 2
