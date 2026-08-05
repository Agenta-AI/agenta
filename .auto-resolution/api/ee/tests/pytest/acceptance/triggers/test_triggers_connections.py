"""EE acceptance tests for the /triggers/connections contract.

Mirrors the OSS suite (oss/tests/pytest/acceptance/triggers/test_triggers_connections.py)
but exercises /triggers/connections as a business-plan, developer-role account.
Under EE the endpoints are gated on the triggers permission surface
(VIEW_TRIGGERS for reads, EDIT_TRIGGERS for writes); a developer role carries
both, so this verifies the contract behaves once the gate is satisfied.

Triggers exposes an independent surface over the SAME shared
``gateway_connections`` rows that ``/tools/connections`` uses; the
cross-visibility roundtrip pins that a connection made on one side is visible
and manageable from the other.

The query endpoint is DB-only and needs no Composio credentials. Create / revoke
make real provider calls, so those are gated on COMPOSIO_API_KEY.

Requires a running API.
"""

import os
from uuid import uuid4

import pytest
import requests

from utils.constants import BASE_TIMEOUT


_COMPOSIO_ENABLED = bool(os.getenv("COMPOSIO_API_KEY"))
_requires_composio = pytest.mark.skipif(
    not _COMPOSIO_ENABLED,
    reason="needs live Composio credentials (COMPOSIO_API_KEY)",
)


def _create_developer_business_account(admin_api):
    uid = uuid4().hex[:12]
    email = f"trig-connections-dev-{uid}@test.agenta.ai"
    resp = admin_api(
        "POST",
        "/admin/simple/accounts/",
        json={
            "accounts": {
                "u": {
                    "user": {"email": email},
                    "options": {
                        "create_api_keys": True,
                        "return_api_keys": True,
                        "seed_defaults": False,
                    },
                    "subscription": {"plan": "cloud_v0_business"},
                    "organization_memberships": [
                        {
                            "organization_ref": {"ref": "org"},
                            "user_ref": {"ref": "user"},
                            "role": "developer",
                        }
                    ],
                    "workspace_memberships": [
                        {
                            "workspace_ref": {"ref": "wrk"},
                            "user_ref": {"ref": "user"},
                            "role": "developer",
                        }
                    ],
                    "project_memberships": [
                        {
                            "project_ref": {"ref": "prj"},
                            "user_ref": {"ref": "user"},
                            "role": "developer",
                        }
                    ],
                }
            }
        },
    )
    assert resp.status_code == 200, resp.text
    account = resp.json()["accounts"]["u"]
    return {
        "email": email,
        "credentials": f"ApiKey {account['api_keys']['key']}",
    }


def _delete_account_by_email(admin_api, *, email):
    resp = admin_api(
        "DELETE",
        "/admin/simple/accounts/",
        json={"accounts": {"u": {"user": {"email": email}}}, "confirm": "delete"},
    )
    assert resp.status_code == 204, resp.text


@pytest.fixture(scope="class")
def connections_api(admin_api, ag_env):
    account = _create_developer_business_account(admin_api)

    def _request(method: str, endpoint: str, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", account["credentials"])
        return requests.request(
            method=method,
            url=f"{ag_env['api_url']}{endpoint}",
            headers=headers,
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    yield _request

    _delete_account_by_email(admin_api, email=account["email"])


class TestTriggersConnectionsQuery:
    def test_query_connections_returns_200(self, connections_api):
        response = connections_api("POST", "/triggers/connections/query")
        assert response.status_code == 200

    def test_query_connections_response_shape(self, connections_api):
        body = connections_api("POST", "/triggers/connections/query").json()
        assert "count" in body
        assert "connections" in body
        assert isinstance(body["connections"], list)
        assert body["count"] == len(body["connections"])


class TestTriggersConnectionsGet:
    def test_get_unknown_connection_returns_404(self, connections_api):
        response = connections_api("GET", f"/triggers/connections/{uuid4()}")
        assert response.status_code == 404


@_requires_composio
class TestTriggersConnectionsLifecycle:
    def test_create_revoke_roundtrip(self, connections_api):
        slug = f"acc-{uuid4().hex[:8]}"
        create = connections_api(
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
            revoke = connections_api(
                "POST", f"/triggers/connections/{connection_id}/revoke"
            )
            assert revoke.status_code == 200, revoke.text
            assert revoke.json()["connection"]["flags"]["is_valid"] is False
        finally:
            delete = connections_api("DELETE", f"/triggers/connections/{connection_id}")
            assert delete.status_code == 204, delete.text


@_requires_composio
class TestConnectionsCrossVisibility:
    """The two surfaces are independent but share rows: a connection made on one
    side appears on the other, and is manageable from either."""

    def test_created_on_triggers_is_visible_on_tools(self, connections_api):
        slug = f"acc-{uuid4().hex[:8]}"
        create = connections_api(
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
            tools_ids = [
                c["id"]
                for c in connections_api("POST", "/tools/connections/query").json()[
                    "connections"
                ]
            ]
            assert connection_id in tools_ids

            fetched = connections_api("GET", f"/tools/connections/{connection_id}")
            assert fetched.status_code == 200, fetched.text
        finally:
            delete = connections_api("DELETE", f"/tools/connections/{connection_id}")
            assert delete.status_code == 204, delete.text

    def test_created_on_tools_is_visible_on_triggers(self, connections_api):
        slug = f"acc-{uuid4().hex[:8]}"
        create = connections_api(
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
                for c in connections_api("POST", "/triggers/connections/query").json()[
                    "connections"
                ]
            ]
            assert connection_id in trigger_ids

            fetched = connections_api("GET", f"/triggers/connections/{connection_id}")
            assert fetched.status_code == 200, fetched.text
        finally:
            delete = connections_api("DELETE", f"/triggers/connections/{connection_id}")
            assert delete.status_code == 204, delete.text
