"""The two mock providers, wired to their in-process upstreams."""

from typing import List

import httpx

from oss.src.core.gateways.mcps.dtos import MCPDirectAuth, MCPResolvedRoute
from oss.src.core.managed_tools.dtos import ManagedActionRateLimit
from oss.src.core.managed_tools.interfaces import ManagedActionProviderInterface
from oss.src.core.managed_tools.mock.actions import (
    MOCK_MCP_PROVIDER,
    MOCK_REST_PROVIDER,
)
from oss.src.core.managed_tools.mock.mcp_upstream import (
    MOCK_MCP_URL,
    MockManagedMCPUpstream,
)
from oss.src.core.managed_tools.mock.rest_app import (
    MOCK_REST_BASE_URL,
    MOCK_REST_CREDENTIAL,
    MOCK_REST_CREDENTIAL_HEADER,
    app,
)
from oss.src.core.managed_tools.providers.mcp import MCPActionProvider
from oss.src.core.managed_tools.providers.rest import RestActionProvider

MOCK_RATE_LIMIT = ManagedActionRateLimit(burst=30, per_minute=60)


def build_mock_providers() -> List[ManagedActionProviderInterface]:
    return [
        RestActionProvider(
            name=MOCK_REST_PROVIDER,
            base_url=MOCK_REST_BASE_URL,
            credential_header=MOCK_REST_CREDENTIAL_HEADER,
            credential=MOCK_REST_CREDENTIAL,
            rate_limit=MOCK_RATE_LIMIT,
            transport=httpx.ASGITransport(app=app),
        ),
        MCPActionProvider(
            name=MOCK_MCP_PROVIDER,
            upstream=MockManagedMCPUpstream(),
            route=MCPResolvedRoute(url=MOCK_MCP_URL),
            auth=MCPDirectAuth(secret=None),
            rate_limit=MOCK_RATE_LIMIT,
        ),
    ]
