"""Unit tests for ChannelsRouter (WP8): the authenticated configuration API.

Mirrors test_wp5_root_router.py's pattern -- a mock Request plus patched
check_action_access, so RBAC gating and service delegation are pinned
without a live app/DB. ChannelsService is an AsyncMock standing in for
WP1's real implementation; that fake is the one collaborator this module
asserts an interface against (see the report for what was assumed).
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request

from oss.src.apis.fastapi.channels.models import (
    ChannelAgentCreateRequest,
    ChannelAgentEditRequest,
    ChannelAgentQueryRequest,
    ChannelConnectionsQueryRequest,
    ChannelGrantCreateRequest,
    ChannelGrantEditRequest,
    ChannelGrantQueryRequest,
    ChannelInboxEventQueryRequest,
    ChannelOutboxEventQueryRequest,
    ChannelPolicyResolveRequest,
    ChannelSpaceCreateRequest,
    ChannelSpaceDiscoverRequest,
    ChannelSpaceEditRequest,
    ChannelSpaceQueryRequest,
    ChannelThreadQueryRequest,
)
from oss.src.apis.fastapi.channels.router import ChannelsRouter
from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentEdit,
    ChannelAgentFlags,
    ChannelGrant,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEdit,
    ChannelGrantFlags,
    ChannelSpace,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceEdit,
    ChannelSpaceKind,
)
from oss.src.core.channels.types import ChannelAgentNotFound


def _make_request(project_id, user_id, method="POST") -> Request:
    app = FastAPI()
    scope = {
        "type": "http",
        "method": method,
        "path": "/channels/",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


def _patched_access(allowed: bool):
    return patch(
        "oss.src.apis.fastapi.channels.router.check_action_access",
        new_callable=AsyncMock,
        return_value=allowed,
    )


def _router(service=None, registry=None) -> ChannelsRouter:
    return ChannelsRouter(
        channels_service=service or AsyncMock(),
        adapter_registry=registry or AsyncMock(keys=lambda: ["slack"]),
    )


def _agent(agent_id, connection_id) -> ChannelAgent:
    return ChannelAgent(
        id=agent_id,
        slug="a",
        connection_id=connection_id,
        data=ChannelAgentData(references={}),
        flags=ChannelAgentFlags(),
    )


def _space(space_id, connection_id) -> ChannelSpace:
    return ChannelSpace(
        id=space_id,
        connection_id=connection_id,
        kind=ChannelSpaceKind.TOPIC,
        external_key=uuid4(),
        data=ChannelSpaceData(external_locator={}),
    )


def _grant(grant_id, agent_id, space_id) -> ChannelGrant:
    return ChannelGrant(
        id=grant_id,
        agent_id=agent_id,
        space_id=space_id,
        data=ChannelGrantData(),
        flags=ChannelGrantFlags(),
    )


# ---------------------------------------------------------------------------
# Permission matrix: every route 403s without its permission, succeeds with.
# Each entry: (coroutine factory) -> (view_permission_route: bool)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "call,is_view_route",
    [
        (lambda r, req: r.list_channels(req), True),
        (
            lambda r, req: r.fetch_channel_capabilities(req, channel="slack"),
            True,
        ),
        (
            lambda r, req: r.query_channel_connections(
                req, body=ChannelConnectionsQueryRequest()
            ),
            True,
        ),
        (
            lambda r, req: r.create_channel_agent(
                req,
                body=ChannelAgentCreateRequest(
                    agent=ChannelAgentCreate(
                        connection_id=uuid4(),
                        slug="a",
                        data=ChannelAgentData(references={}),
                    )
                ),
            ),
            False,
        ),
        (lambda r, req: r.list_channel_agents(req), True),
        (
            lambda r, req: r.query_channel_agents(req, body=ChannelAgentQueryRequest()),
            True,
        ),
        (lambda r, req: r.fetch_channel_agent(req, agent_id=uuid4()), True),
        (
            lambda r, req: r.edit_channel_agent(
                req,
                agent_id=uuid4(),
                body=ChannelAgentEditRequest(
                    agent=ChannelAgentEdit(
                        id=uuid4(), data=ChannelAgentData(references={})
                    )
                ),
            ),
            False,
        ),
        (lambda r, req: r.delete_channel_agent(req, agent_id=uuid4()), False),
        (
            lambda r, req: r.set_channel_agent_default(req, agent_id=uuid4()),
            False,
        ),
        (
            lambda r, req: r.create_channel_space(
                req,
                body=ChannelSpaceCreateRequest(
                    space=ChannelSpaceCreate(
                        connection_id=uuid4(),
                        kind=ChannelSpaceKind.TOPIC,
                        external_key=uuid4(),
                        data=ChannelSpaceData(external_locator={}),
                    )
                ),
            ),
            False,
        ),
        (lambda r, req: r.list_channel_spaces(req), True),
        (
            lambda r, req: r.query_channel_spaces(req, body=ChannelSpaceQueryRequest()),
            True,
        ),
        (lambda r, req: r.fetch_channel_space(req, space_id=uuid4()), True),
        (
            lambda r, req: r.edit_channel_space(
                req,
                space_id=uuid4(),
                body=ChannelSpaceEditRequest(
                    space=ChannelSpaceEdit(
                        id=uuid4(), data=ChannelSpaceData(external_locator={})
                    )
                ),
            ),
            False,
        ),
        (lambda r, req: r.delete_channel_space(req, space_id=uuid4()), False),
        (
            lambda r, req: r.discover_channel_spaces(
                req, body=ChannelSpaceDiscoverRequest(connection_id=uuid4())
            ),
            True,
        ),
        (
            lambda r, req: r.create_channel_grant(
                req,
                body=ChannelGrantCreateRequest(
                    grant=ChannelGrantCreate(
                        agent_id=uuid4(),
                        space_id=uuid4(),
                        data=ChannelGrantData(),
                    )
                ),
            ),
            False,
        ),
        (lambda r, req: r.list_channel_grants(req), True),
        (
            lambda r, req: r.query_channel_grants(req, body=ChannelGrantQueryRequest()),
            True,
        ),
        (
            lambda r, req: r.edit_channel_grant(
                req,
                grant_id=uuid4(),
                body=ChannelGrantEditRequest(
                    grant=ChannelGrantEdit(id=uuid4(), data=ChannelGrantData())
                ),
            ),
            False,
        ),
        (lambda r, req: r.delete_channel_grant(req, grant_id=uuid4()), False),
        (
            lambda r, req: r.set_channel_grant_default(req, grant_id=uuid4()),
            False,
        ),
        (
            lambda r, req: r.resolve_channel_policy(
                req,
                body=ChannelPolicyResolveRequest(agent_id=uuid4(), space_id=uuid4()),
            ),
            True,
        ),
        (
            lambda r, req: r.query_channel_threads(
                req, body=ChannelThreadQueryRequest()
            ),
            True,
        ),
        (
            lambda r, req: r.close_channel_thread(req, thread_id=uuid4()),
            False,
        ),
        (
            lambda r, req: r.query_channel_inbox_events(
                req, body=ChannelInboxEventQueryRequest()
            ),
            True,
        ),
        (
            lambda r, req: r.query_channel_outbox_events(
                req, body=ChannelOutboxEventQueryRequest()
            ),
            True,
        ),
    ],
)
async def test_route_rejects_without_permission(call, is_view_route):
    router = _router()
    request = _make_request(uuid4(), uuid4())

    with _patched_access(False):
        with pytest.raises(HTTPException) as exc_info:
            await call(router, request)

    assert exc_info.value.status_code == 403


async def test_permission_matrix_covers_every_registered_route():
    """Every add_api_route call in __init__ has a matching parametrize entry
    above -- a route added without a matrix entry is a silent RBAC gap."""

    router = _router()
    registered_handlers = {route.endpoint.__name__ for route in router.router.routes}

    exercised = {
        "list_channels",
        "fetch_channel_capabilities",
        "query_channel_connections",
        "create_channel_agent",
        "list_channel_agents",
        "query_channel_agents",
        "fetch_channel_agent",
        "edit_channel_agent",
        "delete_channel_agent",
        "set_channel_agent_default",
        "create_channel_space",
        "list_channel_spaces",
        "query_channel_spaces",
        "fetch_channel_space",
        "edit_channel_space",
        "delete_channel_space",
        "discover_channel_spaces",
        "create_channel_grant",
        "list_channel_grants",
        "query_channel_grants",
        "edit_channel_grant",
        "delete_channel_grant",
        "set_channel_grant_default",
        "resolve_channel_policy",
        "query_channel_threads",
        "close_channel_thread",
        "query_channel_inbox_events",
        "query_channel_outbox_events",
    }

    assert registered_handlers == exercised


# ---------------------------------------------------------------------------
# Default-swap: the router calls the one clear-then-set service verb and
# does not orchestrate the two-step itself.
# ---------------------------------------------------------------------------


async def test_set_channel_agent_default_delegates_to_service_one_call():
    agent_id = uuid4()
    connection_id = uuid4()
    service = AsyncMock()
    service.set_agent_default.return_value = _agent(agent_id, connection_id)
    router = _router(service=service)
    request = _make_request(uuid4(), uuid4())

    with _patched_access(True):
        result = await router.set_channel_agent_default(request, agent_id=agent_id)

    assert result.count == 1
    assert result.agent.id == agent_id
    service.set_agent_default.assert_awaited_once()
    call_kwargs = service.set_agent_default.await_args.kwargs
    assert call_kwargs["agent_id"] == agent_id
    # The router calls exactly one service verb -- it does not fetch-then-edit
    # itself, which would defeat the atomic clear-then-set contract.
    service.edit_agent.assert_not_awaited()


async def test_set_channel_agent_default_404s_on_missing_agent():
    agent_id = uuid4()
    service = AsyncMock()
    service.set_agent_default.side_effect = ChannelAgentNotFound(agent_id=agent_id)
    router = _router(service=service)
    request = _make_request(uuid4(), uuid4())

    with _patched_access(True):
        with pytest.raises(HTTPException) as exc_info:
            await router.set_channel_agent_default(request, agent_id=agent_id)

    assert exc_info.value.status_code == 404


async def test_set_channel_grant_default_delegates_to_service_one_call():
    grant_id, agent_id, space_id = uuid4(), uuid4(), uuid4()
    service = AsyncMock()
    service.set_grant_default.return_value = _grant(grant_id, agent_id, space_id)
    router = _router(service=service)
    request = _make_request(uuid4(), uuid4())

    with _patched_access(True):
        result = await router.set_channel_grant_default(request, grant_id=grant_id)

    assert result.count == 1
    assert result.grant.id == grant_id
    service.set_grant_default.assert_awaited_once()
    service.edit_grant.assert_not_awaited()


# ---------------------------------------------------------------------------
# GET and POST-query are not divergent code paths.
# ---------------------------------------------------------------------------


async def test_list_and_query_channel_agents_call_the_same_service_method():
    connection_id = uuid4()
    agent = _agent(uuid4(), connection_id)
    service = AsyncMock()
    service.query_agents.return_value = [agent]
    router = _router(service=service)
    request = _make_request(uuid4(), uuid4())

    with _patched_access(True):
        list_result = await router.list_channel_agents(request)
        query_result = await router.query_channel_agents(
            request, body=ChannelAgentQueryRequest()
        )

    assert list_result.agents == query_result.agents == [agent]
    assert service.query_agents.await_count == 2


async def test_list_and_query_channel_spaces_call_the_same_service_method():
    space = _space(uuid4(), uuid4())
    service = AsyncMock()
    service.query_spaces.return_value = [space]
    router = _router(service=service)
    request = _make_request(uuid4(), uuid4())

    with _patched_access(True):
        list_result = await router.list_channel_spaces(request)
        query_result = await router.query_channel_spaces(
            request, body=ChannelSpaceQueryRequest()
        )

    assert list_result.spaces == query_result.spaces == [space]
    assert service.query_spaces.await_count == 2


async def test_list_and_query_channel_grants_call_the_same_service_method():
    grant = _grant(uuid4(), uuid4(), uuid4())
    service = AsyncMock()
    service.query_grants.return_value = [grant]
    router = _router(service=service)
    request = _make_request(uuid4(), uuid4())

    with _patched_access(True):
        list_result = await router.list_channel_grants(request)
        query_result = await router.query_channel_grants(
            request, body=ChannelGrantQueryRequest()
        )

    assert list_result.grants == query_result.grants == [grant]
    assert service.query_grants.await_count == 2


# ---------------------------------------------------------------------------
# Trailing-slash audit: collections keep the slash, items do not.
# ---------------------------------------------------------------------------


def test_trailing_slash_audit():
    router = _router()
    collection_paths = {
        "/catalog/channels/",
        "/agents/",
        "/spaces/",
        "/grants/",
    }
    # A path parameter followed by a fixed final segment keeps the trailing
    # slash too (matches ingress's own /{channel}/events/ convention) --
    # only the bare item routes (.../{id}) are slashless.
    trailing_slash_action_paths = {
        "/catalog/channels/{channel}/capabilities/",
    }
    item_or_action_paths = {
        "/connections/query",
        "/agents/query",
        "/agents/{agent_id}",
        "/agents/{agent_id}/default",
        "/spaces/query",
        "/spaces/discover",
        "/spaces/{space_id}",
        "/grants/query",
        "/grants/{grant_id}",
        "/grants/{grant_id}/default",
        "/policy/resolve",
        "/threads/query",
        "/threads/{thread_id}/close",
        "/inbox/events/query",
        "/outbox/events/query",
    }

    seen_paths = {route.path for route in router.router.routes}

    for path in collection_paths | trailing_slash_action_paths:
        assert path in seen_paths
        assert path.endswith("/")

    for path in item_or_action_paths:
        assert path in seen_paths
        assert not path.endswith("/")

    assert (
        seen_paths
        == collection_paths | trailing_slash_action_paths | item_or_action_paths
    )


# ---------------------------------------------------------------------------
# Threads / inbox / outbox: no create route exists anywhere in this router.
# ---------------------------------------------------------------------------


def test_no_create_or_edit_routes_for_threads_inbox_outbox():
    router = _router()
    paths_and_methods = {
        (route.path, method)
        for route in router.router.routes
        for method in route.methods
    }

    for forbidden in (
        ("/threads/", "POST"),
        ("/threads/", "PUT"),
        ("/inbox/events/", "POST"),
        ("/inbox/events/", "PUT"),
        ("/outbox/events/", "POST"),
        ("/outbox/events/", "PUT"),
    ):
        assert forbidden not in paths_and_methods


# ---------------------------------------------------------------------------
# The public ingress path is absent from this router entirely.
# ---------------------------------------------------------------------------


def test_ingress_route_is_absent_from_this_router():
    router = _router()
    paths = {route.path for route in router.router.routes}

    assert "/slack/events/" not in paths
    assert "/bridge/events/" not in paths
    for path in paths:
        assert "events/" not in path or "inbox" in path or "outbox" in path


def test_router_module_does_not_import_ingress_module():
    import oss.src.apis.fastapi.channels.router as router_module

    with open(router_module.__file__, "r", encoding="utf-8") as f:
        source = f.read()

    assert "channels.ingress" not in source
    assert "import ChannelsIngressRouter" not in source
