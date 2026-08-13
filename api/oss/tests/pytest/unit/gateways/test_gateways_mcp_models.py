"""Wire model instantiation — apis/fastapi/gateways/mcps/models.py (entities.md §6).

C0-style: every model in the file constructs with representative values. Also confirms
grants have no create/edit wire model — the interesting absence, by design (§6).
"""

from uuid import uuid4

import pytest

from oss.src.apis.fastapi.gateways.mcps import models as mcps_models_module
from oss.src.apis.fastapi.gateways.mcps.models import (
    McpConnectRequest,
    McpConnectResponse,
    McpEndpointCreateRequest,
    McpEndpointEditRequest,
    McpEndpointQueryRequest,
    McpEndpointResponse,
    McpEndpointsResponse,
    McpGrantQueryRequest,
    McpGrantResponse,
    McpGrantsResponse,
)
from oss.src.core.gateways.dtos import GatewayAuthScheme
from oss.src.core.gateways.mcps.dtos import (
    McpEndpoint,
    McpEndpointCreate,
    McpEndpointData,
    McpEndpointEdit,
    McpEndpointQuery,
    McpGrant,
    McpGrantQuery,
)
from oss.src.core.shared.dtos import Windowing


def _endpoint_create() -> McpEndpointCreate:
    return McpEndpointCreate(
        slug="acme-notion",
        auth_mode=GatewayAuthScheme.NONE,
        data=McpEndpointData(url="https://mcp.acme.example/notion"),
    )


def _endpoint() -> McpEndpoint:
    return McpEndpoint(
        id=uuid4(),
        slug="acme-notion",
        auth_mode=GatewayAuthScheme.NONE,
        data=McpEndpointData(url="https://mcp.acme.example/notion"),
    )


def _grant() -> McpGrant:
    return McpGrant(id=uuid4(), endpoint_id=uuid4(), secret_id=uuid4())


def test_mcp_endpoint_create_request_instantiates():
    request = McpEndpointCreateRequest(endpoint=_endpoint_create())
    assert request.endpoint.slug == "acme-notion"


def test_mcp_endpoint_edit_request_instantiates():
    request = McpEndpointEditRequest(
        endpoint=McpEndpointEdit(
            id=uuid4(),
            auth_mode=GatewayAuthScheme.NONE,
            data=McpEndpointData(url="https://mcp.acme.example/notion"),
        )
    )
    assert request.endpoint.data.url == "https://mcp.acme.example/notion"


def test_mcp_endpoint_query_request_instantiates_with_defaults():
    request = McpEndpointQueryRequest()
    assert request.endpoint is None
    assert request.windowing is None


def test_mcp_endpoint_query_request_instantiates_with_values():
    request = McpEndpointQueryRequest(
        endpoint=McpEndpointQuery(slug="acme-notion"),
        windowing=Windowing(limit=10),
    )
    assert request.endpoint.slug == "acme-notion"
    assert request.windowing.limit == 10


def test_mcp_endpoint_response_instantiates():
    response = McpEndpointResponse(count=1, endpoint=_endpoint())
    assert response.count == 1
    assert response.endpoint.slug == "acme-notion"


def test_mcp_endpoints_response_instantiates():
    response = McpEndpointsResponse(count=1, endpoints=[_endpoint()])
    assert len(response.endpoints) == 1


def test_mcp_endpoints_response_default_list_is_not_shared():
    first = McpEndpointsResponse()
    second = McpEndpointsResponse()
    first.endpoints.append(_endpoint())
    assert second.endpoints == []


def test_mcp_grant_query_request_instantiates():
    request = McpGrantQueryRequest(
        grant=McpGrantQuery(endpoint_id=uuid4()),
        windowing=Windowing(limit=5),
    )
    assert request.windowing.limit == 5


def test_mcp_grant_response_instantiates():
    response = McpGrantResponse(count=1, grant=_grant())
    assert response.count == 1


def test_mcp_grants_response_instantiates():
    response = McpGrantsResponse(count=1, grants=[_grant()])
    assert len(response.grants) == 1


def test_mcp_grants_response_default_list_is_not_shared():
    first = McpGrantsResponse()
    second = McpGrantsResponse()
    first.grants.append(_grant())
    assert second.grants == []


def test_mcp_connect_request_instantiates():
    request = McpConnectRequest(scopes=["read", "write"])
    assert request.scopes == ["read", "write"]


def test_mcp_connect_request_default_scopes_is_not_shared():
    first = McpConnectRequest()
    second = McpConnectRequest()
    first.scopes.append("read")
    assert second.scopes == []


def test_mcp_connect_response_instantiates():
    response = McpConnectResponse(count=1, redirect_url="https://example.com/oauth")
    assert response.redirect_url == "https://example.com/oauth"


def test_no_grant_create_or_edit_request_model_exists():
    """Grants get no create/edit wire model by design (§6) — a grant comes into being
    because a consent flow completed, never because someone POSTed a grant document."""
    names = set(dir(mcps_models_module))
    assert "McpGrantCreateRequest" not in names
    assert "McpGrantEditRequest" not in names

    with pytest.raises(ImportError):
        from oss.src.apis.fastapi.gateways.mcps.models import (  # noqa: F401
            McpGrantCreateRequest,
        )

    with pytest.raises(ImportError):
        from oss.src.apis.fastapi.gateways.mcps.models import (  # noqa: F401
            McpGrantEditRequest,
        )
