"""Unit tests for the Composio triggers catalog full crawl (list_all_events)."""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from oss.src.core.triggers.exceptions import AdapterError
from oss.src.core.triggers.providers.composio.catalog import (
    ComposioTriggersCatalogClient,
)


def _response(items, next_cursor=None):
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {
        "items": items,
        "next_cursor": next_cursor,
        "total_items": len(items),
    }
    return resp


def _client(side_effect):
    client = ComposioTriggersCatalogClient()
    client.api_key = "test-key"
    client.api_url = "https://composio.test/api/v3"
    client._client = MagicMock()
    client._client.get = AsyncMock(side_effect=side_effect)
    return client


def _item(slug, toolkit_slug, toolkit_name=None):
    toolkit = {"slug": toolkit_slug}
    if toolkit_name:
        toolkit["name"] = toolkit_name
    return {
        "slug": slug,
        "name": slug.replace("_", " ").title(),
        "description": f"Fires on {slug}",
        "toolkit": toolkit,
        "config": {"type": "object"},
        "payload": {"sample": True},
    }


async def test_list_all_events_follows_cursor_to_exhaustion():
    client = _client(
        [
            _response(
                [_item("github_issue_opened", "github", "GitHub")],
                next_cursor="page2",
            ),
            _response(
                [_item("slack_message", "slack", "Slack")],
                next_cursor=None,
            ),
        ]
    )

    snapshot = await client.list_all_events()

    assert [event.key for event in snapshot.events] == [
        "github_issue_opened",
        "slack_message",
    ]
    assert snapshot.integration_names == {"github": "GitHub", "slack": "Slack"}
    assert snapshot.events[0].trigger_config == {"type": "object"}
    assert snapshot.events[0].payload == {"sample": True}
    assert client._client.get.await_count == 2
    assert client._client.get.await_args_list[1].kwargs["params"]["cursor"] == "page2"


async def test_list_all_events_stops_on_repeated_cursor():
    client = _client(
        [
            _response([_item("a_event", "a")], next_cursor="loop"),
            _response([_item("b_event", "b")], next_cursor="loop"),
            _response([_item("c_event", "c")], next_cursor="loop"),
        ]
    )

    snapshot = await client.list_all_events()

    assert client._client.get.await_count == 2
    assert [event.key for event in snapshot.events] == ["a_event", "b_event"]


async def test_list_all_events_wraps_http_errors():
    client = _client(httpx.ConnectError("boom"))

    with pytest.raises(AdapterError):
        await client.list_all_events()
