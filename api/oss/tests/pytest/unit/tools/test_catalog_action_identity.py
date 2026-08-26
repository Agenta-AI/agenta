"""Tool identity comes from the catalog, on every call path (qa.md case A19).

A provider action ID that is rebuilt by joining the integration and the tool key was a
production defect: the join is wrong whenever the provider spells the ID differently, and
nothing in the type system catches it. So the catalog parser keeps the provider's own
spelling, and ``get_action`` and ``execute`` read it back through one cached whole-catalog
helper. Every catalog row here carries a provider ID that no concatenation could produce,
so a rebuilt ID fails the assertion instead of passing by coincidence.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.tools import service as service_module
from oss.src.core.tools.dtos import (
    ToolCall,
    ToolCallData,
    ToolCallFunction,
    ToolCatalogAction,
    ToolCatalogActionDetails,
    ToolCatalogActionsPage,
    ToolExecutionResponse,
)
from oss.src.core.tools.exceptions import ActionNotFoundError, AdapterError
from oss.src.core.tools.providers.composio.catalog import (
    ALL_ACTIONS_MAX_PAGES,
    ComposioCatalogClient,
    _parse_action,
)
from oss.src.core.tools.service import ToolsService
from oss.src.utils.env import env


# --- fakes ------------------------------------------------------------------ #


def _action(
    key: str,
    provider_action_id: str,
    *,
    read_only: Optional[bool] = None,
) -> ToolCatalogAction:
    return ToolCatalogAction(
        key=key,
        name=key,
        provider_action_id=provider_action_id,
        read_only=read_only,
    )


class FakeProvider:
    """Stands in for the Composio adapter and records every call the service makes."""

    def __init__(self, catalogs: Dict[str, List[ToolCatalogAction]]):
        self.catalogs = catalogs
        self.crawl_calls: List[str] = []
        self.get_calls: List[dict] = []
        self.execute_calls: List = []

    async def list_all_actions(
        self, *, integration_key: str
    ) -> List[ToolCatalogAction]:
        self.crawl_calls.append(integration_key)
        return self.catalogs[integration_key]

    async def get_action(self, *, action_key: str, provider_action_id: str):
        self.get_calls.append(
            dict(action_key=action_key, provider_action_id=provider_action_id)
        )
        return ToolCatalogActionDetails(
            key=action_key,
            name=action_key,
            provider_action_id=provider_action_id,
        )

    async def execute(self, *, request) -> ToolExecutionResponse:
        self.execute_calls.append(request)
        return ToolExecutionResponse(data=dict(ok=True), successful=True)


def _service(monkeypatch, catalogs) -> Tuple[ToolsService, FakeProvider, list]:
    """A service whose only live seams are the provider adapter and the cache."""
    provider = FakeProvider(catalogs)
    service = object.__new__(ToolsService)
    service.adapter_registry = SimpleNamespace(get=lambda _key: provider)

    store: dict = {}
    writes: list = []

    async def _get(*, namespace, key, model=None, is_list=False, **_kwargs):
        return store.get((namespace, tuple(sorted(key.items()))))

    async def _set(*, namespace, key, value, ttl=None, **_kwargs):
        store[(namespace, tuple(sorted(key.items())))] = value
        writes.append(dict(namespace=namespace, key=key, ttl=ttl, value=value))

    monkeypatch.setattr(service_module, "get_cache", _get)
    monkeypatch.setattr(service_module, "set_cache", _set)
    return service, provider, writes


# --- the parser keeps the provider's spelling ------------------------------- #


@pytest.mark.parametrize(
    "integration_key, provider_slug, expected_key",
    [
        # The plain case: the prefix strips and both halves are kept.
        ("gmail", "GMAIL_SEND_EMAIL", "SEND_EMAIL"),
        # A hyphenated integration whose provider prefix is not the uppercased slug.
        # The naive strip does not match, which is exactly why the ID must be stored.
        (
            "google-calendar",
            "GOOGLECALENDAR_CREATE_EVENT",
            "GOOGLECALENDAR_CREATE_EVENT",
        ),
    ],
)
def test_parsed_action_keeps_the_provider_action_id(
    integration_key, provider_slug, expected_key
):
    action = _parse_action(dict(slug=provider_slug, name="n"), integration_key)

    assert action.provider_action_id == provider_slug
    assert action.key == expected_key


# --- get_action and execute read the stored ID ------------------------------ #


CALENDAR = {
    "google-calendar": [_action("CREATE_EVENT", "GOOGLECALENDAR_CREATE_EVENT_V3")]
}


async def test_get_action_reads_the_id_from_the_catalog(monkeypatch):
    service, provider, _writes = _service(monkeypatch, CALENDAR)

    action = await service.get_action(
        provider_key="composio",
        integration_key="google-calendar",
        action_key="CREATE_EVENT",
    )

    assert provider.get_calls == [
        dict(
            action_key="CREATE_EVENT",
            provider_action_id="GOOGLECALENDAR_CREATE_EVENT_V3",
        )
    ]
    assert action.provider_action_id == "GOOGLECALENDAR_CREATE_EVENT_V3"


async def test_execute_reads_the_id_from_the_catalog(monkeypatch):
    service, provider, _writes = _service(monkeypatch, CALENDAR)

    await service.execute_tool(
        provider_key="composio",
        integration_key="google-calendar",
        action_key="CREATE_EVENT",
        provider_connection_id="acc_1",
        arguments=dict(title="standup"),
    )

    request = provider.execute_calls[0]
    assert request.provider_action_id == "GOOGLECALENDAR_CREATE_EVENT_V3"
    assert request.arguments == dict(title="standup")


async def test_an_unknown_tool_key_is_refused_instead_of_rebuilt(monkeypatch):
    service, provider, _writes = _service(monkeypatch, CALENDAR)

    with pytest.raises(ActionNotFoundError):
        await service.execute_tool(
            provider_key="composio",
            integration_key="google-calendar",
            action_key="DELETE_EVENT",
            arguments={},
        )

    assert provider.execute_calls == []
    assert (
        await service.get_action(
            provider_key="composio",
            integration_key="google-calendar",
            action_key="DELETE_EVENT",
        )
        is None
    )
    assert provider.get_calls == []


# --- overlapping integration prefixes --------------------------------------- #


OVERLAP = {
    "slack": [_action("SEND_MESSAGE", "SLACK_SENDMESSAGE_V2")],
    "slackbot": [_action("SEND_MESSAGE", "SLACKBOT_SENDMESSAGE_V2")],
}


@pytest.mark.parametrize(
    "integration_key, expected_id",
    [
        ("slack", "SLACK_SENDMESSAGE_V2"),
        ("slackbot", "SLACKBOT_SENDMESSAGE_V2"),
    ],
)
async def test_overlapping_prefixes_resolve_to_their_own_id(
    monkeypatch, integration_key, expected_id
):
    """``slack`` and ``slackbot`` share a tool key; each must keep its own provider ID."""
    service, provider, _writes = _service(monkeypatch, OVERLAP)

    await service.execute_tool(
        provider_key="composio",
        integration_key=integration_key,
        action_key="SEND_MESSAGE",
        arguments={},
    )

    assert provider.execute_calls[0].provider_action_id == expected_id


# --- the legacy five-segment call path uses the same lookup ----------------- #


async def test_legacy_five_segment_call_resolves_the_same_id(monkeypatch):
    """The saved tools.provider.integration.action.connection route."""
    service, provider, _writes = _service(monkeypatch, OVERLAP)

    async def _connection(**_kwargs):
        return SimpleNamespace(provider_connection_id="acc_9", data={})

    monkeypatch.setattr(service, "resolve_connection_by_slug", _connection)

    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)

    await ToolsRouter(tools_service=service).call_tool(
        SimpleNamespace(
            state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4())),
            headers={},
        ),
        body=ToolCall(
            data=ToolCallData(
                id="call_1",
                function=ToolCallFunction(
                    name="tools.composio.slack.SEND_MESSAGE.slack-work",
                    arguments=dict(text="hi"),
                ),
            )
        ),
    )

    assert provider.execute_calls[0].provider_action_id == "SLACK_SENDMESSAGE_V2"


# --- the service caches the whole catalog ----------------------------------- #


GITHUB = {
    "github": [
        _action("GET_ISSUE", "GITHUB_GET_ISSUE_V1", read_only=True),
        _action("CREATE_ISSUE", "GITHUB_CREATE_ISSUE_V1", read_only=False),
    ]
}


async def test_a_second_call_is_served_from_the_cache(monkeypatch):
    service, provider, writes = _service(monkeypatch, GITHUB)

    first = await service.list_all_actions(
        provider_key="composio", integration_key="github"
    )
    second = await service.list_all_actions(
        provider_key="composio", integration_key="github"
    )

    assert [t.key for t in second] == [t.key for t in first]
    assert provider.crawl_calls == ["github"]

    # One write, holding the whole catalog under its own namespace and its own key.
    # The router's per-page tools:catalog:* entries are a different cache.
    assert len(writes) == 1
    assert writes[0]["namespace"] == "tools:catalog:all"
    assert writes[0]["key"] == dict(provider="composio", integration="github")
    assert writes[0]["ttl"] == env.composio.catalog_cache_ttl_seconds


async def test_the_cached_entry_holds_identity_only(monkeypatch):
    """Descriptions and schemas are display data; this entry sits on the run path."""
    service, _provider, writes = _service(monkeypatch, GITHUB)

    entries = await service.list_all_actions(
        provider_key="composio", integration_key="github"
    )

    assert [(t.key, t.provider_action_id, t.read_only) for t in entries] == [
        ("GET_ISSUE", "GITHUB_GET_ISSUE_V1", True),
        ("CREATE_ISSUE", "GITHUB_CREATE_ISSUE_V1", False),
    ]
    assert set(entries[0].model_dump().keys()) == {
        "key",
        "provider_action_id",
        "read_only",
    }
    assert writes[0]["value"] == entries


async def test_a_crawl_that_exceeds_the_deadline_raises(monkeypatch):
    """A slow provider must not hold a resolve or a tool call open indefinitely."""
    service, provider, writes = _service(monkeypatch, GITHUB)

    async def _hang(*, integration_key):
        await asyncio.sleep(1)
        return []

    provider.list_all_actions = _hang
    monkeypatch.setattr(env.composio, "catalog_fetch_deadline_seconds", 0.01)

    with pytest.raises(AdapterError):
        await service.list_all_actions(
            provider_key="composio", integration_key="github"
        )

    assert writes == []


# --- the provider crawl walks every page ------------------------------------ #


def _client(monkeypatch, pages) -> Tuple[ComposioCatalogClient, list]:
    """The real crawl, over a fake page sequence."""
    client = object.__new__(ComposioCatalogClient)
    calls: list = []

    async def _list_actions(*, integration_key, limit=None, cursor=None, **_kwargs):
        calls.append(cursor)
        index = 0 if cursor is None else [n for _, n in pages].index(cursor) + 1
        actions, next_cursor = pages[index]
        return ToolCatalogActionsPage(
            actions=actions, next_cursor=next_cursor, total=len(pages)
        )

    monkeypatch.setattr(client, "list_actions", _list_actions)
    return client, calls


# Three pages, the last one full: a cursor that ends on an exact page boundary must
# terminate. A crawl tested only against a single page truncates a large integration
# in production and looks correct in the test.
PAGES = [
    ([_action("GET_ISSUE", "GITHUB_GET_ISSUE_V1")], "c1"),
    ([_action("CREATE_ISSUE", "GITHUB_CREATE_ISSUE_V1")], "c2"),
    ([_action("CLOSE_ISSUE", "GITHUB_CLOSE_ISSUE_V1")], None),
]


async def test_the_crawl_assembles_every_page(monkeypatch):
    client, calls = _client(monkeypatch, PAGES)

    actions = await client.list_all_actions(integration_key="github")

    assert [a.key for a in actions] == ["GET_ISSUE", "CREATE_ISSUE", "CLOSE_ISSUE"]
    assert calls == [None, "c1", "c2"]


async def test_a_repeated_cursor_raises(monkeypatch):
    """Stopping and returning what came before would cache a catalog missing tools."""
    client, _calls = _client(
        monkeypatch,
        [
            ([_action("GET_ISSUE", "GITHUB_GET_ISSUE_V1")], "c1"),
            ([_action("CREATE_ISSUE", "GITHUB_CREATE_ISSUE_V1")], "c1"),
        ],
    )

    with pytest.raises(AdapterError):
        await client.list_all_actions(integration_key="github")


async def test_a_catalog_that_never_ends_raises(monkeypatch):
    endless = [
        ([_action("TOOL_" + str(page), "GITHUB_TOOL_" + str(page))], "c" + str(page))
        for page in range(ALL_ACTIONS_MAX_PAGES + 1)
    ]
    client, _calls = _client(monkeypatch, endless)

    with pytest.raises(AdapterError):
        await client.list_all_actions(integration_key="github")
