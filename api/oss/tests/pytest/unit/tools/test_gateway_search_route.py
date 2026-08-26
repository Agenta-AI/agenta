"""``gateway.search`` translates a provider search into Agenta keys and nothing more.

The route reads the provider from the private context and the query from the model. It
returns every translated result: the agent's configured set and its permissions live in
the runner's private policy, so the runner is the only place that can filter this list.
An API-side permission filter would encode the wrong ownership (qa.md case A4).

Replays the recorded provider response at ``fixtures/composio_search_tools.json``. No
network, no live Composio.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.tools import service as service_module
from oss.src.core.tools.dtos import (
    ToolCall,
    ToolCallContext,
    ToolCallData,
    ToolCallFunction,
)
from oss.src.core.tools.exceptions import AdapterError
from oss.src.core.tools.providers.composio.dtos import (
    ComposioSearchQueryResult,
    ComposioSearchResult,
    ComposioToolSchema,
)
from oss.src.core.tools.service import ToolsService


FIXTURE = Path(__file__).parent / "fixtures" / "composio_search_tools.json"


def _parsed_search() -> ComposioSearchResult:
    return ComposioSearchResult.model_validate(json.loads(FIXTURE.read_text())["data"])


def _search_result_with(count: int) -> ComposioSearchResult:
    """A provider answer with ``count`` fully translatable hits for one integration."""
    slugs = [f"GITHUB_TOOL_{index}" for index in range(count)]
    return ComposioSearchResult(
        results=[
            ComposioSearchQueryResult(
                use_case="do a thing",
                primary_tool_slugs=slugs[:1],
                related_tool_slugs=slugs[1:],
                toolkits=["github"],
            )
        ],
        tool_schemas={
            slug: ComposioToolSchema(
                toolkit="GITHUB",
                tool_slug=slug,
                description="A tool.",
                input_schema={"type": "object", "properties": {}, "required": []},
            )
            for slug in slugs
        },
    )


class FakeSearchProvider:
    """Records what the service asks the provider for, and answers the fixture."""

    def __init__(self, *, result=None, error: Optional[Exception] = None):
        self.result = result
        self.error = error
        self.calls: List[Dict[str, Any]] = []

    async def search_capabilities(self, *, use_cases, user_id, toolkits=None):
        self.calls.append(
            {"use_cases": use_cases, "user_id": user_id, "toolkits": toolkits}
        )
        if self.error is not None:
            raise self.error
        return self.result if self.result is not None else _parsed_search()


def _router(monkeypatch, provider: FakeSearchProvider, *, cache=None) -> ToolsRouter:
    service = object.__new__(ToolsService)
    service.adapter_registry = SimpleNamespace(get=lambda _key: provider)

    # A dict standing in for the shared cache, so a test can prove a second identical
    # query is answered without a second provider call.
    store: Dict[str, Any] = {} if cache is None else cache

    async def _get_cache(*, namespace=None, key=None, model=None, is_list=False):
        return store.get(json.dumps([namespace, key], sort_keys=True))

    async def _set_cache(*, namespace=None, key=None, value=None, ttl=None):
        store[json.dumps([namespace, key], sort_keys=True)] = value

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


def _search_call(*, query="post a message", integration=None, provider="composio"):
    arguments: Dict[str, Any] = {"query": query}
    if integration is not None:
        arguments["integration"] = integration
    return ToolCall(
        data=ToolCallData(
            id="call_search_1",
            function=ToolCallFunction(name="gateway.search", arguments=arguments),
        ),
        context=ToolCallContext(provider=provider),
    )


async def _search(router: ToolsRouter, body: ToolCall) -> Dict[str, Any]:
    response = await router.call_tool(_request(), body=body)
    return json.loads(response.call.data.content)


# ---------------------------------------------------------------------------
# A1, A2, A3: translation
# ---------------------------------------------------------------------------


async def test_results_are_agenta_integration_and_tool_keys(monkeypatch):
    """A1: the model never sees a provider slug, only integration + tool."""
    router = _router(monkeypatch, FakeSearchProvider())

    content = await _search(router, _search_call())

    identities = [(r["integration"], r["tool"]) for r in content["results"]]
    assert ("github", "CREATE_AN_ISSUE") in identities
    assert ("slack", "SEND_MESSAGE") in identities
    # The provider slug is split, never echoed: no tool key keeps its toolkit prefix.
    assert all(
        not tool.startswith(integration.upper()) for integration, tool in identities
    )
    # One slug appears under two use cases in the fixture; the model sees it once.
    assert len(identities) == len(set(identities))


async def test_each_result_carries_a_name_and_an_object_schema(monkeypatch):
    """A2."""
    router = _router(monkeypatch, FakeSearchProvider())

    content = await _search(router, _search_call())

    assert content["results"]
    for result in content["results"]:
        assert result["name"]
        assert result["description"]
        assert result["input_schema"]["type"] == "object"

    send = next(r for r in content["results"] if r["tool"] == "SEND_MESSAGE")
    assert send["name"] == "Send message"
    assert "channel" in send["input_schema"]["properties"]


async def test_a_result_the_api_cannot_translate_is_dropped(monkeypatch):
    """A3: a slug with no usable object schema cannot become a callable result."""
    router = _router(monkeypatch, FakeSearchProvider())

    content = await _search(router, _search_call())

    # The fixture carries this slug as an alternative but ships no schema for it, so
    # the model would have nothing to fill in.
    assert all(r["tool"] != "GET_AN_ISSUE" for r in content["results"])
    assert all(r["tool"] != "UPDATE_AN_ISSUE" for r in content["results"])


@pytest.mark.parametrize(
    "input_schema",
    [
        # Properties do not make a schema an object, and `arguments` must be one.
        {"type": "array", "properties": {"channel": {"type": "string"}}},
        {"type": "string"},
        {"properties": {"channel": {"type": "string"}}},
        None,
        "an object, honestly",
    ],
)
async def test_a_hit_without_an_object_schema_is_dropped(monkeypatch, input_schema):
    """A3: the model fills in an object, so anything else is not a callable result."""
    search = _search_result_with(1)
    only = next(iter(search.tool_schemas))
    search.tool_schemas[only].input_schema = input_schema
    router = _router(monkeypatch, FakeSearchProvider(result=search))

    content = await _search(router, _search_call())

    assert content["results"] == []


async def test_a_result_never_carries_provider_or_policy_fields(monkeypatch):
    router = _router(monkeypatch, FakeSearchProvider())

    content = await _search(router, _search_call())

    for result in content["results"]:
        assert set(result.keys()) == {
            "integration",
            "tool",
            "name",
            "description",
            "input_schema",
        }


# ---------------------------------------------------------------------------
# A4: the API applies no agent permission
# ---------------------------------------------------------------------------


async def test_the_api_does_not_filter_by_agent_permission(monkeypatch):
    """A4: the runner owns the policy filter, so nothing here is dropped for it.

    The API is told only which provider to search. It is never told which integrations
    the agent configured or what it may run, so a filter here could only be a guess.
    The result therefore holds integrations the agent may not have configured at all.
    """
    router = _router(monkeypatch, FakeSearchProvider())

    content = await _search(router, _search_call())

    # Several integrations, and mutating tools beside read-only ones. Nothing was
    # dropped for a permission the API was never given.
    assert {"github", "slack"} <= {r["integration"] for r in content["results"]}
    tools = {r["tool"] for r in content["results"]}
    assert "CREATE_AN_ISSUE" in tools
    assert "SEND_MESSAGE" in tools


async def test_the_api_does_not_cap_the_result_count(monkeypatch):
    """The five-result cap belongs to the runner, after it has applied the policy.

    Capping here would spend the budget on results the runner is about to drop.
    """
    provider = FakeSearchProvider(result=_search_result_with(7))
    router = _router(monkeypatch, provider)

    content = await _search(router, _search_call())

    assert len(content["results"]) == 7


# ---------------------------------------------------------------------------
# A5: an empty query
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("query", ["", "   ", None, 7, ["post a message"]])
async def test_an_empty_query_is_refused_before_the_provider(monkeypatch, query):
    """A5."""
    provider = FakeSearchProvider()
    router = _router(monkeypatch, provider)

    body = ToolCall(
        data=ToolCallData(
            id="call_search_1",
            function=ToolCallFunction(
                name="gateway.search", arguments={"query": query}
            ),
        ),
        context=ToolCallContext(provider="composio"),
    )
    response = await router.call_tool(_request(), body=body)

    assert response.call.status.code == "STATUS_CODE_ERROR"
    error = json.loads(response.call.data.content)
    assert error["code"] == "invalid_arguments"
    assert error["retryable"] is False
    assert error["next_step"]
    assert provider.calls == []


async def test_arguments_that_are_not_an_object_are_refused(monkeypatch):
    provider = FakeSearchProvider()
    router = _router(monkeypatch, provider)

    body = ToolCall(
        data=ToolCallData(
            id="call_search_1",
            function=ToolCallFunction(
                name="gateway.search", arguments='{"query": "post a message"}'
            ),
        ),
        context=ToolCallContext(provider="composio"),
    )
    response = await router.call_tool(_request(), body=body)

    error = json.loads(response.call.data.content)
    assert error["code"] == "invalid_arguments"
    assert provider.calls == []


# ---------------------------------------------------------------------------
# The private context
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("context", [None, ToolCallContext(integration="slack")])
async def test_a_call_without_a_provider_context_is_refused(monkeypatch, context):
    """A missing context has no default to fall back to, so the call cannot proceed."""
    from fastapi import HTTPException

    provider = FakeSearchProvider()
    router = _router(monkeypatch, provider)

    body = ToolCall(
        data=ToolCallData(
            id="call_search_1",
            function=ToolCallFunction(
                name="gateway.search", arguments={"query": "post a message"}
            ),
        ),
        context=context,
    )

    with pytest.raises(HTTPException) as caught:
        await router.call_tool(_request(), body=body)

    assert caught.value.status_code == 400
    assert provider.calls == []


async def test_the_provider_comes_from_the_context(monkeypatch):
    provider = FakeSearchProvider()
    service_calls: List[str] = []
    router = _router(monkeypatch, provider)
    registry_get = router.tools_service.adapter_registry.get

    def _get(provider_key):
        service_calls.append(provider_key)
        return registry_get(provider_key)

    router.tools_service.adapter_registry = SimpleNamespace(get=_get)

    await _search(router, _search_call(provider="composio"))

    assert service_calls == ["composio"]


# ---------------------------------------------------------------------------
# A7: a provider failure
# ---------------------------------------------------------------------------


async def test_a_provider_failure_is_a_retryable_search_error(monkeypatch):
    """A7."""
    provider = FakeSearchProvider(
        error=AdapterError(
            provider_key="composio",
            operation="search_capabilities",
            detail="connection reset",
        )
    )
    router = _router(monkeypatch, provider)

    response = await router.call_tool(_request(), body=_search_call())

    assert response.call.status.code == "STATUS_CODE_ERROR"
    error = json.loads(response.call.data.content)
    assert error["code"] == "tool_search_unavailable"
    assert error["retryable"] is True
    assert error["next_step"]


# ---------------------------------------------------------------------------
# A8: the search cache
# ---------------------------------------------------------------------------


async def test_an_identical_query_does_not_call_the_provider_twice(monkeypatch):
    """A8."""
    provider = FakeSearchProvider()
    router = _router(monkeypatch, provider)

    first = await _search(router, _search_call(query="post a message"))
    second = await _search(router, _search_call(query="post a message"))

    assert len(provider.calls) == 1
    assert first == second


async def test_a_scoped_query_does_not_replay_the_unscoped_answer(monkeypatch):
    """A scoped search asks a different question, so it gets its own cache entry."""
    provider = FakeSearchProvider()
    router = _router(monkeypatch, provider)

    await _search(router, _search_call(query="post a message"))
    await _search(router, _search_call(query="post a message", integration="slack"))

    assert [call["toolkits"] for call in provider.calls] == [None, ["slack"]]


# ---------------------------------------------------------------------------
# A9: the native toolkit filter
# ---------------------------------------------------------------------------


async def test_the_requested_integration_reaches_the_provider_as_a_filter(monkeypatch):
    """A9, at the service seam: the integration is passed, never woven into the text."""
    provider = FakeSearchProvider()
    router = _router(monkeypatch, provider)

    await _search(router, _search_call(query="post a message", integration="slack"))

    assert provider.calls == [
        {
            "use_cases": ["post a message"],
            "user_id": provider.calls[0]["user_id"],
            "toolkits": ["slack"],
        }
    ]
    # The query text is the model's own words. Enriching it to imitate a filter is the
    # fallback the design rejected once native scoping was measured.
    assert "slack" not in provider.calls[0]["use_cases"][0]


async def test_the_outbound_provider_request_carries_the_toolkit_filter(monkeypatch):
    """A9, at the wire: the scoped request body Composio actually receives."""
    from oss.src.core.tools.providers.composio.adapter import ComposioToolsAdapter

    adapter = object.__new__(ComposioToolsAdapter)
    captured: Dict[str, Any] = {}
    fixture = json.loads(FIXTURE.read_text())

    async def _post(path, *, json=None):
        captured["path"] = path
        captured["json"] = json
        return fixture

    monkeypatch.setattr(adapter, "_post", _post)

    await adapter.search_capabilities(
        use_cases=["post a message"],
        user_id="proj-1",
        toolkits=["slack"],
    )

    assert captured["path"] == "/tools/execute/COMPOSIO_SEARCH_TOOLS"
    assert captured["json"]["arguments"]["queries"] == [
        {"use_case": "post a message", "toolkits": ["slack"]}
    ]


async def test_an_unscoped_search_sends_no_toolkit_key(monkeypatch):
    """Without an integration the request is exactly the one discovery already sends."""
    from oss.src.core.tools.providers.composio.adapter import ComposioToolsAdapter

    adapter = object.__new__(ComposioToolsAdapter)
    captured: Dict[str, Any] = {}
    fixture = json.loads(FIXTURE.read_text())

    async def _post(path, *, json=None):
        captured["json"] = json
        return fixture

    monkeypatch.setattr(adapter, "_post", _post)

    await adapter.search_capabilities(use_cases=["post a message"], user_id="proj-1")

    assert captured["json"]["arguments"]["queries"] == [{"use_case": "post a message"}]


@pytest.mark.integration
@pytest.mark.skipif(
    not os.getenv("COMPOSIO_API_KEY"),
    reason="COMPOSIO_API_KEY not set; skipping the live toolkit-scoping check",
)
async def test_the_provider_really_scopes_a_search_to_the_toolkit():
    """The filter above is only worth sending if the provider honours it.

    Scoping was measured by hand on 2026-08-26 and the unit test pins the request
    shape, but a field name the provider silently ignores would leave that test green
    while every scoped search stayed unscoped. This is the check that would notice.
    """
    from oss.src.core.tools.providers.composio.adapter import ComposioToolsAdapter

    adapter = ComposioToolsAdapter(api_key=os.environ["COMPOSIO_API_KEY"])
    try:
        result = await adapter.search_capabilities(
            use_cases=["send a message"],
            user_id="pytest-toolkit-scope",
            toolkits=["slack"],
        )
    finally:
        await adapter.close()

    toolkits = {
        toolkit.lower() for entry in result.results for toolkit in entry.toolkits
    }
    assert toolkits, "the provider returned no toolkit for a scoped search"
    assert toolkits <= {"slack", "slackbot"}


async def test_a_scoped_search_keeps_only_the_requested_integration(monkeypatch):
    """The model asked for one integration, so a neighbouring one is not an answer."""
    router = _router(monkeypatch, FakeSearchProvider())

    content = await _search(
        router, _search_call(query="post a message", integration="slack")
    )

    assert {r["integration"] for r in content["results"]} == {"slack"}
