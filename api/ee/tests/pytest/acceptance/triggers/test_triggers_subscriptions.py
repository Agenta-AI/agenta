"""EE acceptance tests for /triggers/subscriptions/* and /triggers/deliveries/*.

Mirrors the OSS suite but exercises the routes as a business-plan,
developer-role account. Subscription CRUD is gated on EDIT_TRIGGERS and reads on
VIEW_TRIGGERS; a developer role carries both, so this verifies the routes behave
once the gate is satisfied.

The read/query surfaces are DB-only (no Composio needed). The full create ->
list -> disable -> delete roundtrip, including the C7 invariant (deleting a
subscription leaves the shared connection intact), mints a provider-side trigger
instance and is gated on COMPOSIO_API_KEY.

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

# Minting a trigger instance needs an ACTIVE connected account, which a stub
# OAuth connection never reaches in CI (no interactive auth).
_requires_connected_account = pytest.mark.skipif(
    not os.getenv("COMPOSIO_TEST_CONNECTED_ACCOUNT"),
    reason="needs COMPOSIO_TEST_CONNECTED_ACCOUNT (an ACTIVE connected account)",
)


def _create_developer_business_account(admin_api):
    uid = uuid4().hex[:12]
    email = f"triggers-sub-dev-{uid}@test.agenta.ai"
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
def triggers_api(admin_api, ag_env):
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


# ---------------------------------------------------------------------------
# DB-only: reads, queries, 404s
# ---------------------------------------------------------------------------


class TestTriggerSubscriptionsReads:
    def test_list_subscriptions_returns_200_empty(self, triggers_api):
        response = triggers_api("GET", "/triggers/subscriptions/")
        assert response.status_code == 200
        body = response.json()
        assert "count" in body
        assert isinstance(body["subscriptions"], list)
        assert body["count"] == len(body["subscriptions"])

    def test_query_subscriptions_returns_200(self, triggers_api):
        response = triggers_api("POST", "/triggers/subscriptions/query", json={})
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == len(body["subscriptions"])

    def test_fetch_unknown_subscription_returns_404(self, triggers_api):
        response = triggers_api("GET", f"/triggers/subscriptions/{uuid4()}")
        assert response.status_code == 404

    def test_delete_unknown_subscription_returns_404(self, triggers_api):
        response = triggers_api("DELETE", f"/triggers/subscriptions/{uuid4()}")
        assert response.status_code == 404


class TestTriggerDeliveriesReads:
    def test_list_deliveries_returns_200_empty(self, triggers_api):
        response = triggers_api("GET", "/triggers/deliveries")
        assert response.status_code == 200
        body = response.json()
        assert isinstance(body["deliveries"], list)
        assert body["count"] == len(body["deliveries"])

    def test_query_deliveries_returns_200(self, triggers_api):
        response = triggers_api("POST", "/triggers/deliveries/query", json={})
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == len(body["deliveries"])

    def test_fetch_unknown_delivery_returns_404(self, triggers_api):
        response = triggers_api("GET", f"/triggers/deliveries/{uuid4()}")
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Full lifecycle (needs Composio) — C7 invariant included
# ---------------------------------------------------------------------------


@_requires_composio
@_requires_connected_account
class TestTriggerSubscriptionsLifecycle:
    def _create_connection(self, triggers_api):
        slug = f"acc-{uuid4().hex[:8]}"
        create = triggers_api(
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
        return create.json()["connection"]["id"]

    def test_create_list_disable_delete_keeps_connection(self, triggers_api):
        connection_id = self._create_connection(triggers_api)

        try:
            create = triggers_api(
                "POST",
                "/triggers/subscriptions/",
                json={
                    "subscription": {
                        "name": f"sub-{uuid4().hex[:8]}",
                        "connection_id": connection_id,
                        "data": {
                            "event_key": "GITHUB_STAR_ADDED_EVENT",
                            "trigger_config": {"owner": "acme", "repo": "widgets"},
                            "inputs_fields": {"repo": "$.event.attributes.repository"},
                            "references": {"workflow": {"slug": "triage"}},
                        },
                    }
                },
            )
            assert create.status_code == 200, create.text
            sub = create.json()["subscription"]
            subscription_id = sub["id"]
            assert sub["connection_id"] == connection_id
            assert sub["trigger_id"] is not None

            listing = triggers_api("GET", "/triggers/subscriptions/").json()
            assert any(s["id"] == subscription_id for s in listing["subscriptions"])

            revoke = triggers_api(
                "POST", f"/triggers/subscriptions/{subscription_id}/revoke"
            )
            assert revoke.status_code == 200, revoke.text
            assert revoke.json()["subscription"]["enabled"] is False

            delete = triggers_api(
                "DELETE", f"/triggers/subscriptions/{subscription_id}"
            )
            assert delete.status_code == 204

            fetch = triggers_api("GET", f"/triggers/subscriptions/{subscription_id}")
            assert fetch.status_code == 404

            # C7: deleting the subscription must NOT delete/revoke the connection.
            conn = triggers_api("GET", f"/tools/connections/{connection_id}")
            assert conn.status_code == 200, conn.text
        finally:
            triggers_api("DELETE", f"/tools/connections/{connection_id}")
