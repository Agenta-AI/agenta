"""An in-memory stand-in for the two endpoint operations the OAuth connect service uses.

A connection nobody stored explicitly reads as the OAuth connection its latest attempt was
started on, so a test about the exchange does not have to build an endpoint row first. A
test about a connection that changed under an attempt stores that connection with `put`.
"""

from typing import Dict, Optional
from uuid import UUID

from oss.src.core.gateways.dtos import GatewayAuthScheme
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointData,
    MCPEndpointRoute,
    is_oauth_connection_for,
)
from oss.tests.pytest.utils.mcp_oauth_attempts import InMemoryMCPOAuthAttemptsDAO


class InMemoryMCPEndpoints:
    def __init__(self, *, attempts: InMemoryMCPOAuthAttemptsDAO) -> None:
        self.attempts = attempts
        self.endpoints: Dict[UUID, MCPEndpoint] = {}

    def put(self, endpoint: MCPEndpoint) -> None:
        self.endpoints[endpoint.id] = endpoint

    async def fetch_endpoint(self, *, project_id, endpoint_id) -> Optional[MCPEndpoint]:
        return self._current(endpoint_id)

    def _current(self, endpoint_id) -> Optional[MCPEndpoint]:
        if endpoint_id in self.endpoints:
            return self.endpoints[endpoint_id]
        started = [
            record
            for record in self.attempts.attempts.values()
            if record.endpoint_id == endpoint_id
        ]
        if not started:
            return None
        return MCPEndpoint(
            id=endpoint_id,
            slug=f"oauth-{endpoint_id.hex[:8]}",
            auth_mode=GatewayAuthScheme.OAUTH,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url=started[-1].server_url)
            ),
        )

    async def bind_endpoint_secret(
        self,
        *,
        project_id,
        user_id,
        endpoint_id,
        secret_id,
        oauth_server_url=None,
        oauth_client_id=None,
    ) -> Optional[MCPEndpoint]:
        # Read directly, as the real bind reads the row it locks.
        current = self._current(endpoint_id)
        if current is None:
            return None
        if oauth_server_url is not None and not is_oauth_connection_for(
            current, oauth_server_url, oauth_client_id
        ):
            return None
        bound = current.model_copy(update={"secret_id": secret_id})
        self.endpoints[endpoint_id] = bound
        return bound
