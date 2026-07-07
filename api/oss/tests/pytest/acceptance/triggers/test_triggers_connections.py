"""Acceptance tests for the /triggers/connections contract.

Triggers exposes an independent ``/triggers/connections/*`` surface over the
SAME shared ``gateway_connections`` rows that ``/tools/connections/*`` uses.
The two endpoints do not depend on each other, yet a connection made from one
side is visible from the other — that cross-visibility is the invariant pinned
here.

The query / get endpoints are DB-only (no Composio credentials needed). Create
/ revoke make real provider calls, so the lifecycle + cross-visibility roundtrip
is gated on COMPOSIO_API_KEY.
"""

import os
from uuid import uuid4

import pytest


_COMPOSIO_ENABLED = bool(os.getenv("COMPOSIO_API_KEY"))
_requires_composio = pytest.mark.skipif(
    not _COMPOSIO_ENABLED,
    reason="needs live Composio credentials (COMPOSIO_API_KEY)",
)


class TestTriggersConnectionsQuery:
    def test_query_connections_returns_200(self, authed_api):
        response = authed_api("POST", "/triggers/connections/query")
        assert response.status_code == 200

    def test_query_connections_response_shape(self, authed_api):
        body = authed_api("POST", "/triggers/connections/query").json()
        assert "count" in body
        assert "connections" in body
        assert isinstance(body["connections"], list)
        assert body["count"] == len(body["connections"])


class TestTriggersConnectionsGet:
    def test_get_unknown_connection_returns_404(self, authed_api):
        response = authed_api("GET", f"/triggers/connections/{uuid4()}")
        assert response.status_code == 404


@_requires_composio
class TestTriggersConnectionsLifecycle:
    def test_create_revoke_roundtrip(self, authed_api):
        slug = f"acc-{uuid4().hex[:8]}"
        create = authed_api(
            "POST",
            "/triggers/connections/",
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
        connection_id = create.json()["connection"]["id"]

        try:
            revoke = authed_api("POST", f"/triggers/connections/{connection_id}/revoke")
            assert revoke.status_code == 200, revoke.text
            assert revoke.json()["connection"]["flags"]["is_valid"] is False
        finally:
            delete = authed_api("DELETE", f"/triggers/connections/{connection_id}")
            assert delete.status_code == 204, delete.text


@_requires_composio
class TestConnectionsCrossVisibility:
    """The two surfaces are independent but share rows: a connection made on one
    side appears on the other, and is manageable from either."""

    def test_created_on_triggers_is_visible_on_tools(self, authed_api):
        slug = f"acc-{uuid4().hex[:8]}"
        create = authed_api(
            "POST",
            "/triggers/connections/",
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
        connection_id = create.json()["connection"]["id"]

        try:
            # Visible via the tools query surface…
            tools_ids = [
                c["id"]
                for c in authed_api("POST", "/tools/connections/query").json()[
                    "connections"
                ]
            ]
            assert connection_id in tools_ids

            # …and fetchable + manageable via the tools surface.
            fetched = authed_api("GET", f"/tools/connections/{connection_id}")
            assert fetched.status_code == 200, fetched.text
        finally:
            delete = authed_api("DELETE", f"/tools/connections/{connection_id}")
            assert delete.status_code == 204, delete.text

    def test_created_on_tools_is_visible_on_triggers(self, authed_api):
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
        connection_id = create.json()["connection"]["id"]

        try:
            trigger_ids = [
                c["id"]
                for c in authed_api("POST", "/triggers/connections/query").json()[
                    "connections"
                ]
            ]
            assert connection_id in trigger_ids

            fetched = authed_api("GET", f"/triggers/connections/{connection_id}")
            assert fetched.status_code == 200, fetched.text
        finally:
            delete = authed_api("DELETE", f"/triggers/connections/{connection_id}")
            assert delete.status_code == 204, delete.text
