"""Acceptance tests for the /tools/connections contract (WP0).

The connection now lives in the routerless ``connections`` domain backed by the
``gateway_connections`` table, but the public HTTP surface stays at
``/tools/connections`` byte-for-byte. These tests pin that contract.

The query endpoint is DB-only — it needs no Composio credentials. A fresh
project returns an empty, well-shaped list, which also proves the table rename
landed (the query hits ``gateway_connections``). Create / refresh / revoke make
real provider calls, so those are gated on COMPOSIO_API_KEY.
"""

import os
from uuid import uuid4

import pytest


_COMPOSIO_ENABLED = bool(os.getenv("COMPOSIO_API_KEY"))
_requires_composio = pytest.mark.skipif(
    not _COMPOSIO_ENABLED,
    reason="needs live Composio credentials (COMPOSIO_API_KEY)",
)


class TestToolsConnectionsQuery:
    def test_query_connections_returns_200(self, authed_api):
        response = authed_api("POST", "/tools/connections/query")
        assert response.status_code == 200

    def test_query_connections_response_shape(self, authed_api):
        body = authed_api("POST", "/tools/connections/query").json()
        assert "count" in body
        assert "connections" in body
        assert isinstance(body["connections"], list)
        assert body["count"] == len(body["connections"])


class TestToolsConnectionsGet:
    def test_get_unknown_connection_returns_404(self, authed_api):
        response = authed_api("GET", f"/tools/connections/{uuid4()}")
        assert response.status_code == 404


@_requires_composio
class TestToolsConnectionsLifecycle:
    def test_create_revoke_roundtrip(self, authed_api):
        slug = f"acc-{uuid4().hex[:8]}"
        create = authed_api(
            "POST",
            "/tools/connections/",
            json={
                "connection": {
                    "slug": slug,
                    "provider_key": "composio",
                    "integration_key": "github",
                    "data": {"auth_scheme": "oauth"},
                }
            },
        )
        assert create.status_code == 200, create.text
        connection = create.json()["connection"]
        connection_id = connection["id"]

        # Local-only revoke (C7/B3): flips is_valid on the shared row, no
        # provider call, no cascade.
        revoke = authed_api("POST", f"/tools/connections/{connection_id}/revoke")
        assert revoke.status_code == 200, revoke.text
        assert revoke.json()["connection"]["flags"]["is_valid"] is False

        authed_api("DELETE", f"/tools/connections/{connection_id}")
