from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.tools.models import CapabilitiesQuery
from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.tools.discovery import (
    FIND_CAPABILITIES_CALL_REF,
    FIND_CAPABILITIES_INPUT_SCHEMA,
    looks_like_trigger,
    map_guidance_text,
    parse_find_capabilities_arguments,
    referenced_integrations,
    split_composio_slug,
    translate_search_result,
)
from oss.src.core.tools.dtos import (
    CapabilitiesResult,
    Capability,
    CapabilityConnection,
    ConnectAffordance,
    ConnectionRequirement,
    DiscoveredTool,
    ToolAuthScheme,
    ToolCall,
    ToolCallData,
    ToolCallFunction,
    ToolConnectionState,
)
from oss.src.core.tools.providers.composio.dtos import (
    ComposioSearchQueryResult,
    ComposioSearchResult,
)
from oss.src.core.tools.exceptions import AdapterError, DiscoveryUnsupportedError
from oss.src.core.tools.service import ToolsService

FIXTURE = Path(__file__).parent / "fixtures" / "composio_search_tools.json"


def _load_fixture() -> dict:
    return json.loads(FIXTURE.read_text())


def _parsed_search() -> ComposioSearchResult:
    return ComposioSearchResult.model_validate(_load_fixture()["data"])


# ---------------------------------------------------------------------------
# Adapter: recorded-fixture replay (no live Composio)
# ---------------------------------------------------------------------------


async def test_adapter_search_capabilities_parses_recorded_response(monkeypatch):
    from oss.src.core.tools.providers.composio.adapter import ComposioToolsAdapter

    adapter = object.__new__(ComposioToolsAdapter)
    captured: dict = {}
    fixture = _load_fixture()

    async def _post(path, *, json=None):
        captured["path"] = path
        captured["json"] = json
        return fixture

    monkeypatch.setattr(adapter, "_post", _post)

    result = await adapter.search_capabilities(
        use_cases=["create a github issue", "post a slack reply"],
        user_id="proj-123",
    )

    # Calls the search meta-tool through the execute endpoint with the right body.
    assert captured["path"] == "/tools/execute/COMPOSIO_SEARCH_TOOLS"
    assert captured["json"]["user_id"] == "proj-123"
    assert captured["json"]["arguments"]["queries"] == [
        {"use_case": "create a github issue"},
        {"use_case": "post a slack reply"},
    ]
    assert captured["json"]["arguments"]["session"] == {"generate_id": True}

    # Parses results + schemas + connection statuses; ignores status_message.
    assert isinstance(result, ComposioSearchResult)
    assert len(result.results) == 4
    assert result.results[1].primary_tool_slugs == ["GITHUB_CREATE_AN_ISSUE"]
    assert "GITHUB_CREATE_AN_ISSUE" in result.tool_schemas
    assert result.tool_schemas["GITHUB_CREATE_AN_ISSUE"].input_schema["required"] == [
        "owner",
        "repo",
        "title",
    ]
    statuses = {
        s.toolkit: s.has_active_connection for s in result.toolkit_connection_statuses
    }
    assert statuses == {"github": True, "slack": False, "slackbot": False}


@pytest.mark.parametrize(
    "envelope",
    [
        # successful=false with an error message (HTTP 200, tool-level failure).
        {"successful": False, "error": "rate limited", "data": {}},
        # successful=true but data is missing/None.
        {"successful": True, "error": None, "data": None},
        # successful=true but data is malformed (results is not a list).
        {"successful": True, "error": None, "data": {"results": "nope"}},
        # a non-object envelope (list / scalar) must not raise AttributeError on .get().
        [],
        "unexpected string body",
    ],
)
async def test_adapter_search_capabilities_raises_on_bad_envelope(
    monkeypatch, envelope
):
    from oss.src.core.tools.providers.composio.adapter import ComposioToolsAdapter

    adapter = object.__new__(ComposioToolsAdapter)

    async def _post(path, *, json=None):
        return envelope

    monkeypatch.setattr(adapter, "_post", _post)

    # A failed/empty/malformed envelope is an adapter error, not a silent empty result.
    with pytest.raises(AdapterError):
        await adapter.search_capabilities(use_cases=["x"], user_id="proj-123")


# ---------------------------------------------------------------------------
# Pure translation helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "slug, toolkits, expected",
    [
        ("GITHUB_CREATE_AN_ISSUE", ["github"], ("github", "CREATE_AN_ISSUE")),
        # Longest toolkit prefix wins: slackbot, not slack.
        ("SLACKBOT_SEND_MESSAGE", ["slack", "slackbot"], ("slackbot", "SEND_MESSAGE")),
        ("SLACK_SEND_MESSAGE", ["slack", "slackbot"], ("slack", "SEND_MESSAGE")),
        # Fallback: split on first underscore when no toolkit matches.
        ("GMAIL_SEND_EMAIL", [], ("gmail", "SEND_EMAIL")),
    ],
)
def test_split_composio_slug(slug, toolkits, expected):
    assert split_composio_slug(slug, toolkits) == expected


def test_map_guidance_text_rewrites_only_known_toolkit_slugs():
    text = "SLACK_SEND_MESSAGE is not idempotent; return JSON over HTTP."
    mapped = map_guidance_text(text, ["slack"])
    assert "slack.SEND_MESSAGE" in mapped
    # Unrelated all-caps tokens are left alone (no toolkit prefix match).
    assert "JSON" in mapped and "HTTP" in mapped
    assert "SLACK_SEND_MESSAGE" not in mapped


@pytest.mark.parametrize(
    "use_case, expected",
    [
        ("listen for new messages in a slack support channel", True),
        ("trigger when a new issue is created", True),
        ("create a github issue", False),
        ("post a reply in a slack thread", False),
    ],
)
def test_looks_like_trigger(use_case, expected):
    assert looks_like_trigger(use_case) is expected


def test_referenced_integrations_caps_alternatives_and_dedupes():
    search = _parsed_search()
    integrations = referenced_integrations(search, limit_alternatives=3)
    # github (from issues + create), slack + slackbot (slack reply), in first-seen order.
    assert integrations == ["github", "slack", "slackbot"]


def test_referenced_integrations_uses_only_first_primary():
    # _translate_one exposes only primary_tool_slugs[0] as the tool, so the extra
    # primary's integration must not appear in connections[].
    search = ComposioSearchResult(
        results=[
            ComposioSearchQueryResult(
                use_case="do a thing",
                primary_tool_slugs=["GITHUB_CREATE_AN_ISSUE", "STRIPE_CREATE_CHARGE"],
                toolkits=["github", "stripe"],
            )
        ]
    )
    assert referenced_integrations(search, limit_alternatives=3) == ["github"]


# ---------------------------------------------------------------------------
# Pure translation: Composio search -> Agenta-native CapabilitiesResult
# ---------------------------------------------------------------------------


def _states() -> dict[str, ConnectionRequirement]:
    return {
        "github": ConnectionRequirement(
            integration="github",
            state=ToolConnectionState.READY,
            slug="github-main",
        ),
        "slack": ConnectionRequirement(
            integration="slack",
            state=ToolConnectionState.NEEDS_AUTH,
            connect=ConnectAffordance(
                body={
                    "connection": {
                        "provider_key": "composio",
                        "integration_key": "slack",
                        "slug": "slack-main",
                    }
                }
            ),
        ),
        "slackbot": ConnectionRequirement(
            integration="slackbot",
            state=ToolConnectionState.NEEDS_AUTH,
        ),
    }


def test_translate_builds_agenta_native_contract():
    search = _parsed_search()
    result = translate_search_result(
        search,
        _states(),
        limit_alternatives=3,
        trigger_use_cases={"listen for new messages in a slack support channel"},
    )

    by_use_case = {c.use_case: c for c in result.capabilities}

    # GitHub create: ready -> tool carries the connection slug + the input schema.
    create = by_use_case["create a github issue"]
    assert create.tool.integration == "github"
    assert create.tool.action == "CREATE_AN_ISSUE"
    assert create.tool.connection == "github-main"
    assert create.tool.provider_action == "GITHUB_CREATE_AN_ISSUE"
    assert create.tool.input_schema["required"] == ["owner", "repo", "title"]
    assert create.connection.state == ToolConnectionState.READY
    # Alternatives capped at 3 (the fixture lists 4).
    assert len(create.alternatives) == 3
    assert create.alternatives[0].action == "UPDATE_AN_ISSUE"

    # Slack reply: needs_auth -> tool carries NO connection slug.
    reply = by_use_case["post a reply in a slack thread with a link"]
    assert reply.tool.integration == "slack"
    assert reply.tool.action == "SEND_MESSAGE"
    assert reply.tool.connection is None
    assert reply.connection.state == ToolConnectionState.NEEDS_AUTH
    assert reply.connection.slug is None
    # SLACKBOT alternative maps to the slackbot integration, not slack.
    slackbot_alt = [a for a in reply.alternatives if a.integration == "slackbot"]
    assert slackbot_alt and slackbot_alt[0].action == "SEND_MESSAGE"

    # Trigger-shaped use_case carries a note (D5).
    listen = by_use_case["listen for new messages in a slack support channel"]
    assert listen.note is not None and "trigger" in listen.note.lower()
    assert any("trigger" in n.lower() for n in result.notes)

    # connections[]: one per referenced integration.
    states = {c.integration: c for c in result.connections}
    assert states["github"].state == ToolConnectionState.READY
    assert states["github"].slug == "github-main"
    assert states["slack"].state == ToolConnectionState.NEEDS_AUTH
    assert states["slack"].connect.endpoint == "POST /tools/connections/"

    # Guidance maps Composio slugs to friendly names (no Composio leaks).
    joined = " ".join(result.guidance.pitfalls + result.guidance.plan_steps)
    assert "slack.SEND_MESSAGE" in joined
    assert "github.CREATE_AN_ISSUE" in joined
    assert "SLACK_SEND_MESSAGE" not in joined
    assert "GITHUB_CREATE_AN_ISSUE" not in joined

    # Not every connection is ready -> ready is False.
    assert result.ready is False


def test_translate_ready_true_when_all_primary_connections_ready():
    search = _parsed_search()
    all_ready = {
        integ: ConnectionRequirement(
            integration=integ,
            state=ToolConnectionState.READY,
            slug=f"{integ}-main",
        )
        for integ in referenced_integrations(search, limit_alternatives=3)
    }
    result = translate_search_result(search, all_ready, limit_alternatives=3)
    assert result.ready is True


def test_translate_ready_false_when_a_use_case_has_no_primary():
    # One use_case resolves; the other has no primary tool. ready must stay False
    # rather than silently dropping the unresolved use_case from the readiness check.
    search = ComposioSearchResult(
        results=[
            ComposioSearchQueryResult(
                use_case="create a github issue",
                primary_tool_slugs=["GITHUB_CREATE_AN_ISSUE"],
                toolkits=["github"],
            ),
            ComposioSearchQueryResult(
                use_case="do something composio cannot match",
                primary_tool_slugs=[],
                toolkits=[],
            ),
        ]
    )
    states = {
        "github": ConnectionRequirement(
            integration="github",
            state=ToolConnectionState.READY,
            slug="github-main",
        )
    }
    result = translate_search_result(search, states, limit_alternatives=3)
    assert result.ready is False
    unresolved = next(c for c in result.capabilities if c.tool is None)
    assert unresolved.connection is None


# ---------------------------------------------------------------------------
# Service orchestration: connection-state derivation + the D6 cache split
# ---------------------------------------------------------------------------


def _fake_connection(
    *, slug, is_active=True, is_valid=True, provider_id="acc_1", has_auth=True
):
    return SimpleNamespace(
        slug=slug,
        is_active=is_active,
        is_valid=is_valid,
        provider_connection_id=provider_id,
        has_auth=has_auth,
    )


def _service_with(monkeypatch, *, connections_by_integration, auth_schemes):
    service = object.__new__(ToolsService)

    async def _query_connections(
        *, project_id, provider_key, integration_key, is_active=None
    ):
        return connections_by_integration.get(integration_key, [])

    async def _get_integration(*, provider_key, integration_key):
        schemes = auth_schemes.get(integration_key)
        return SimpleNamespace(auth_schemes=schemes) if schemes is not None else None

    monkeypatch.setattr(service, "query_connections", _query_connections)
    monkeypatch.setattr(service, "get_integration", _get_integration)
    return service


async def test_connection_state_ready_needs_auth_needs_input(monkeypatch):
    service = _service_with(
        monkeypatch,
        connections_by_integration={
            "github": [_fake_connection(slug="github-main")],
            # slack has only an inactive row -> not ready.
            "slack": [_fake_connection(slug="slack-old", is_active=False)],
        },
        auth_schemes={
            "slack": [ToolAuthScheme.OAUTH],
            "stripe": [ToolAuthScheme.API_KEY],
        },
    )

    ready = await service._discovery_connection_state(
        project_id=uuid4(), provider_key="composio", integration_key="github"
    )
    assert ready.state == ToolConnectionState.READY
    assert ready.slug == "github-main"
    assert ready.connect is None

    needs_auth = await service._discovery_connection_state(
        project_id=uuid4(), provider_key="composio", integration_key="slack"
    )
    assert needs_auth.state == ToolConnectionState.NEEDS_AUTH
    assert needs_auth.slug is None
    assert needs_auth.connect.body["connection"]["slug"] == "slack-main"

    needs_input = await service._discovery_connection_state(
        project_id=uuid4(), provider_key="composio", integration_key="stripe"
    )
    assert needs_input.state == ToolConnectionState.NEEDS_INPUT
    assert needs_input.connect is not None


async def test_discover_capabilities_end_to_end(monkeypatch):
    service = _service_with(
        monkeypatch,
        connections_by_integration={
            "github": [_fake_connection(slug="github-main")],
        },
        auth_schemes={
            "slack": [ToolAuthScheme.OAUTH],
            "slackbot": [ToolAuthScheme.OAUTH],
        },
    )

    search = _parsed_search()

    calls = {"search": 0}

    async def _search_capabilities(*, use_cases, user_id):
        calls["search"] += 1
        return search

    fake_adapter = SimpleNamespace(search_capabilities=_search_capabilities)
    service.adapter_registry = SimpleNamespace(get=lambda _k: fake_adapter)

    # Caching disabled for this run (miss + no-op write).
    async def _miss(**_kwargs):
        return None

    async def _noop(**_kwargs):
        return None

    monkeypatch.setattr("oss.src.core.tools.service.get_cache", _miss)
    monkeypatch.setattr("oss.src.core.tools.service.set_cache", _noop)

    result = await service.discover_capabilities(
        project_id=uuid4(),
        use_cases=[
            "search github issues for a matching report",
            "create a github issue",
            "post a reply in a slack thread with a link",
            "listen for new messages in a slack support channel",
        ],
    )

    assert calls["search"] == 1
    by_use_case = {c.use_case: c for c in result.capabilities}
    assert (
        by_use_case["create a github issue"].connection.state
        == ToolConnectionState.READY
    )
    assert by_use_case["create a github issue"].tool.connection == "github-main"
    assert (
        by_use_case["post a reply in a slack thread with a link"].connection.state
        == ToolConnectionState.NEEDS_AUTH
    )
    assert result.ready is False


async def test_discover_caches_tool_schema_half_recomputes_state_fresh(monkeypatch):
    """D6: a cache hit skips the search but still recomputes connection state."""
    service = _service_with(
        monkeypatch,
        connections_by_integration={"github": [_fake_connection(slug="github-main")]},
        auth_schemes={
            "slack": [ToolAuthScheme.OAUTH],
            "slackbot": [ToolAuthScheme.OAUTH],
        },
    )

    cached = _parsed_search().model_copy(update={"toolkit_connection_statuses": []})

    async def _hit(**_kwargs):
        return cached

    async def _noop(**_kwargs):
        return None

    called = {"search": 0, "query": 0}

    async def _search_capabilities(*, use_cases, user_id):
        called["search"] += 1
        return _parsed_search()

    inner_query = service.query_connections

    async def _counting_query(**kwargs):
        called["query"] += 1
        return await inner_query(**kwargs)

    monkeypatch.setattr(service, "query_connections", _counting_query)
    service.adapter_registry = SimpleNamespace(
        get=lambda _k: SimpleNamespace(search_capabilities=_search_capabilities)
    )
    monkeypatch.setattr("oss.src.core.tools.service.get_cache", _hit)
    monkeypatch.setattr("oss.src.core.tools.service.set_cache", _noop)

    result = await service.discover_capabilities(
        project_id=uuid4(),
        use_cases=["create a github issue", "post a reply in a slack thread"],
    )

    # Tool/schema half came from cache (search not called); state recomputed fresh.
    assert called["search"] == 0
    assert called["query"] >= 1
    assert result.capabilities


async def test_discover_raises_when_provider_lacks_search(monkeypatch):
    service = object.__new__(ToolsService)
    service.adapter_registry = SimpleNamespace(get=lambda _k: SimpleNamespace())

    async def _miss(**_kwargs):
        return None

    async def _noop(**_kwargs):
        return None

    monkeypatch.setattr("oss.src.core.tools.service.get_cache", _miss)
    monkeypatch.setattr("oss.src.core.tools.service.set_cache", _noop)

    with pytest.raises(DiscoveryUnsupportedError):
        await service.discover_capabilities(
            project_id=uuid4(),
            use_cases=["do a thing"],
            provider_key="agenta",
        )


# ---------------------------------------------------------------------------
# Reserved tool: parse_find_capabilities_arguments + input schema
# ---------------------------------------------------------------------------


def test_find_capabilities_input_schema_shape():
    assert FIND_CAPABILITIES_CALL_REF == "tools.agenta.find_capabilities"
    assert FIND_CAPABILITIES_INPUT_SCHEMA["required"] == ["use_cases"]
    assert FIND_CAPABILITIES_INPUT_SCHEMA["properties"]["use_cases"]["type"] == "array"


def test_parse_find_capabilities_arguments_normalizes():
    use_cases, provider, limit = parse_find_capabilities_arguments(
        {"use_cases": ["a", "  ", "b"], "provider": "composio", "limit_alternatives": 5}
    )
    assert use_cases == ["a", "b"]
    assert provider == "composio"
    assert limit == 5

    # Defaults + bad limit fall back cleanly.
    use_cases, provider, limit = parse_find_capabilities_arguments(
        {"use_cases": ["x"], "limit_alternatives": "oops"}
    )
    assert (use_cases, provider, limit) == (["x"], "composio", 3)


def test_parse_find_capabilities_arguments_coerces_scalar_string():
    # A bare string is one use_case, not iterated character-by-character.
    use_cases, _provider, _limit = parse_find_capabilities_arguments(
        {"use_cases": "create a github issue"}
    )
    assert use_cases == ["create a github issue"]

    # A non-list, non-string value yields no use_cases.
    use_cases, _provider, _limit = parse_find_capabilities_arguments({"use_cases": 42})
    assert use_cases == []


# ---------------------------------------------------------------------------
# Router: POST /tools/discover + the tools.agenta.find_capabilities call branch
# ---------------------------------------------------------------------------


def _capabilities_result() -> CapabilitiesResult:
    return CapabilitiesResult(
        capabilities=[
            Capability(
                use_case="create a github issue",
                integration="github",
                tool=DiscoveredTool(
                    integration="github",
                    action="CREATE_AN_ISSUE",
                    connection="github-main",
                    provider_action="GITHUB_CREATE_AN_ISSUE",
                ),
                connection=CapabilityConnection(
                    state=ToolConnectionState.READY, slug="github-main"
                ),
            )
        ],
        ready=True,
    )


def _router_with_discover(discover_fn):
    return ToolsRouter(
        tools_service=SimpleNamespace(discover_capabilities=discover_fn),
        workflows_service=None,
    )


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4()))
    )


def _call(name, arguments) -> ToolCall:
    return ToolCall(
        data=ToolCallData(
            id="call_1",
            function=ToolCallFunction(name=name, arguments=arguments),
        )
    )


async def test_discover_route_returns_capabilities(monkeypatch):
    captured = {}

    async def _discover(*, project_id, use_cases, provider_key, limit_alternatives):
        captured.update(
            project_id=project_id,
            use_cases=use_cases,
            provider_key=provider_key,
            limit_alternatives=limit_alternatives,
        )
        return _capabilities_result()

    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)

    router = _router_with_discover(_discover)
    request = _request()
    result = await router.discover_capabilities(
        request,
        body=CapabilitiesQuery(
            use_cases=["create a github issue"], provider="composio"
        ),
    )

    assert isinstance(result, CapabilitiesResult)
    assert result.ready is True
    assert str(captured["project_id"]) == request.state.project_id
    assert captured["use_cases"] == ["create a github issue"]


async def test_discover_route_maps_unsupported_provider_to_422(monkeypatch):
    async def _discover(**_kwargs):
        raise DiscoveryUnsupportedError("agenta")

    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)

    with pytest.raises(HTTPException) as caught:
        await _router_with_discover(_discover).discover_capabilities(
            _request(),
            body=CapabilitiesQuery(use_cases=["x"], provider="agenta"),
        )
    assert caught.value.status_code == 422


def test_capabilities_query_rejects_empty_use_cases():
    with pytest.raises(Exception):
        CapabilitiesQuery(use_cases=["  ", ""])


def test_capabilities_query_rejects_scalar_string():
    # A bare string must be rejected, not iterated into one-char fragments.
    with pytest.raises(Exception):
        CapabilitiesQuery(use_cases="create a github issue")


async def test_call_agenta_tool_runs_find_capabilities():
    captured = {}

    async def _discover(*, project_id, use_cases, provider_key, limit_alternatives):
        captured.update(use_cases=use_cases, provider_key=provider_key)
        return _capabilities_result()

    router = _router_with_discover(_discover)
    response = await router._call_agenta_tool(
        request=_request(),
        body=_call(
            "tools.agenta.find_capabilities",
            {"use_cases": ["create a github issue"]},
        ),
    )

    assert captured["use_cases"] == ["create a github issue"]
    assert response.call.status.code == "STATUS_CODE_OK"
    payload = json.loads(response.call.data.content)
    assert payload["ready"] is True
    assert payload["capabilities"][0]["tool"]["action"] == "CREATE_AN_ISSUE"
    assert response.call.data.tool_call_id == "call_1"


async def test_call_agenta_tool_parses_json_string_arguments():
    async def _discover(*, project_id, use_cases, provider_key, limit_alternatives):
        return _capabilities_result()

    response = await _router_with_discover(_discover)._call_agenta_tool(
        request=_request(),
        body=_call("tools__agenta__find_capabilities", '{"use_cases": ["x"]}'),
    )
    assert response.call.status.code == "STATUS_CODE_OK"


async def test_call_agenta_tool_unknown_op_404():
    async def _discover(**_kwargs):
        return _capabilities_result()

    with pytest.raises(HTTPException) as caught:
        await _router_with_discover(_discover)._call_agenta_tool(
            request=_request(),
            body=_call("tools.agenta.unknown_op", {"use_cases": ["x"]}),
        )
    assert caught.value.status_code == 404


async def test_call_agenta_tool_empty_use_cases_400():
    async def _discover(**_kwargs):
        return _capabilities_result()

    with pytest.raises(HTTPException) as caught:
        await _router_with_discover(_discover)._call_agenta_tool(
            request=_request(),
            body=_call("tools.agenta.find_capabilities", {"use_cases": []}),
        )
    assert caught.value.status_code == 400


async def test_call_agenta_tool_unsupported_provider_422():
    async def _discover(**_kwargs):
        raise DiscoveryUnsupportedError("agenta")

    with pytest.raises(HTTPException) as caught:
        await _router_with_discover(_discover)._call_agenta_tool(
            request=_request(),
            body=_call(
                "tools.agenta.find_capabilities",
                {"use_cases": ["x"], "provider": "agenta"},
            ),
        )
    assert caught.value.status_code == 422


async def test_call_tool_agenta_branch_requires_view_tools(monkeypatch):
    # The reserved tool exposes per-project connection state, so RUN_TOOLS alone (the
    # outer gate) must not reach it: the tools.agenta.* branch also needs VIEW_TOOLS.
    from oss.src.core.access.permissions.types import Permission

    async def _discover(**_kwargs):  # pragma: no cover - must not be reached
        return _capabilities_result()

    async def _access(*, permission, **_kwargs):
        return permission != Permission.VIEW_TOOLS

    monkeypatch.setattr(
        "oss.src.apis.fastapi.tools.router.check_action_access", _access
    )

    with pytest.raises(HTTPException) as caught:
        await _router_with_discover(_discover).call_tool(
            _request(),
            body=_call(
                "tools.agenta.find_capabilities",
                {"use_cases": ["create a github issue"]},
            ),
        )
    assert caught.value.status_code == 403
