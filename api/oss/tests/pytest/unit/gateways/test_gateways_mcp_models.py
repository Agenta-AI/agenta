"""Wire model instantiation — apis/fastapi/gateways/mcps/models.py (entities.md §6).

C0-style: every model in the file constructs with representative values. Also confirms
"""

from uuid import uuid4


from oss.src.apis.fastapi.gateways.mcps.models import (
    MCPConnectRequest,
    MCPConnectResponse,
    MCPEndpointCreateRequest,
    MCPEndpointEditRequest,
    MCPEndpointQueryRequest,
    MCPEndpointResponse,
    MCPEndpointsResponse,
)
from oss.src.core.gateways.mcps.dtos import MCPAuthScheme
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointEdit,
    MCPEndpointQuery,
    MCPEndpointRoute,
)
from oss.src.core.shared.dtos import Windowing


def _endpoint_create() -> MCPEndpointCreate:
    return MCPEndpointCreate(
        slug="acme-notion",
        auth_mode=MCPAuthScheme.NONE,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url="https://mcp.acme.example/notion")
        ),
    )


def _endpoint() -> MCPEndpoint:
    return MCPEndpoint(
        id=uuid4(),
        slug="acme-notion",
        auth_mode=MCPAuthScheme.NONE,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url="https://mcp.acme.example/notion")
        ),
    )


def test_mcp_endpoint_create_request_instantiates():
    request = MCPEndpointCreateRequest(endpoint=_endpoint_create())
    assert request.endpoint.slug == "acme-notion"


def test_mcp_endpoint_edit_request_instantiates():
    request = MCPEndpointEditRequest(
        endpoint=MCPEndpointEdit(
            id=uuid4(),
            auth_mode=MCPAuthScheme.NONE,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://mcp.acme.example/notion")
            ),
        )
    )
    assert request.endpoint.data.route.base_url == "https://mcp.acme.example/notion"


def test_mcp_endpoint_query_request_instantiates_with_defaults():
    request = MCPEndpointQueryRequest()
    assert request.endpoint is None
    assert request.windowing is None


def test_mcp_endpoint_query_request_instantiates_with_values():
    request = MCPEndpointQueryRequest(
        endpoint=MCPEndpointQuery(slug="acme-notion"),
        windowing=Windowing(limit=10),
    )
    assert request.endpoint.slug == "acme-notion"
    assert request.windowing.limit == 10


def test_mcp_endpoint_response_instantiates():
    response = MCPEndpointResponse(count=1, endpoint=_endpoint())
    assert response.count == 1
    assert response.endpoint.slug == "acme-notion"


def test_mcp_endpoints_response_instantiates():
    response = MCPEndpointsResponse(count=1, endpoints=[_endpoint()])
    assert len(response.endpoints) == 1


def test_mcp_endpoints_response_default_list_is_not_shared():
    first = MCPEndpointsResponse()
    second = MCPEndpointsResponse()
    first.endpoints.append(_endpoint())
    assert second.endpoints == []


def test_mcp_connect_request_instantiates():
    request = MCPConnectRequest(scopes=["read", "write"])
    assert request.scopes == ["read", "write"]


def test_mcp_connect_request_default_scopes_is_none():
    """`scopes: None` (absent) is the discover step, not an empty-list default
    (specs-wp18.md) — WP17's own scaffold used a shared-list default; WP18 changes
    the semantics on purpose so a caller can distinguish "haven't chosen yet" from
    "chose nothing"."""
    request = MCPConnectRequest()
    assert request.scopes is None


def test_mcp_connect_response_instantiates():
    response = MCPConnectResponse(count=1, redirect_url="https://example.com/oauth")
    assert response.redirect_url == "https://example.com/oauth"
