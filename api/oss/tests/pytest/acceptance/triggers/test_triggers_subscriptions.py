"""Acceptance tests for /triggers/subscriptions/* and /triggers/deliveries/*.

The read/query surfaces are DB-only — a fresh project returns well-shaped empty
lists and 404s with no Composio credentials, which also proves the
trigger_subscriptions / trigger_deliveries tables landed (migration ran).

Creating a subscription mints a provider-side trigger instance (ti_*) on a
shared gateway connection, so the full create -> list -> disable -> delete
roundtrip (and the C7 invariant — deleting a subscription leaves the connection
intact) is gated on COMPOSIO_API_KEY being present in the runner's environment.

Requires a running API.
"""

import os
from uuid import uuid4

import pytest


_COMPOSIO_ENABLED = bool(os.getenv("COMPOSIO_API_KEY"))
_requires_composio = pytest.mark.skipif(
    not _COMPOSIO_ENABLED,
    reason="needs live Composio credentials (COMPOSIO_API_KEY)",
)

# Minting a trigger instance needs an ACTIVE connected account, which a stub
# OAuth connection never reaches in CI (no interactive auth). Gate the create
# roundtrip on a pre-connected account being supplied.
_requires_connected_account = pytest.mark.skipif(
    not os.getenv("COMPOSIO_TEST_CONNECTED_ACCOUNT"),
    reason="needs COMPOSIO_TEST_CONNECTED_ACCOUNT (an ACTIVE connected account)",
)


def _create_workflow(authed_api):
    """Build a workflow + variant + committed revision; return its slug."""
    slug = f"sub-wf-{uuid4().hex[:8]}"

    wf = authed_api(
        "POST", "/workflows/", json={"workflow": {"slug": slug, "name": slug}}
    )
    assert wf.status_code == 200, wf.text
    workflow_id = wf.json()["workflow"]["id"]

    variant = authed_api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"{slug}-v",
                "name": "Default",
                "workflow_id": workflow_id,
            }
        },
    )
    assert variant.status_code == 200, variant.text
    variant_id = variant.json()["workflow_variant"]["id"]

    commit = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"{slug}-v1",
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
                "message": "initial",
            }
        },
    )
    assert commit.status_code == 200, commit.text
    return slug


# ---------------------------------------------------------------------------
# DB-only: reads, queries, 404s (no Composio needed)
# ---------------------------------------------------------------------------


class TestTriggerSubscriptionsReads:
    def test_list_subscriptions_returns_200_empty(self, authed_api):
        body = authed_api("GET", "/triggers/subscriptions/").json()
        assert "count" in body
        assert "subscriptions" in body
        assert isinstance(body["subscriptions"], list)
        assert body["count"] == len(body["subscriptions"])

    def test_query_subscriptions_returns_200(self, authed_api):
        response = authed_api("POST", "/triggers/subscriptions/query", json={})
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == len(body["subscriptions"])

    def test_fetch_unknown_subscription_returns_404(self, authed_api):
        response = authed_api("GET", f"/triggers/subscriptions/{uuid4()}")
        assert response.status_code == 404

    def test_delete_unknown_subscription_returns_404(self, authed_api):
        response = authed_api("DELETE", f"/triggers/subscriptions/{uuid4()}")
        assert response.status_code == 404

    def test_refresh_unknown_subscription_returns_404(self, authed_api):
        response = authed_api("POST", f"/triggers/subscriptions/{uuid4()}/refresh")
        assert response.status_code == 404

    def test_revoke_unknown_subscription_returns_404(self, authed_api):
        response = authed_api("POST", f"/triggers/subscriptions/{uuid4()}/revoke")
        assert response.status_code == 404


class TestTriggerDeliveriesReads:
    def test_list_deliveries_returns_200_empty(self, authed_api):
        body = authed_api("GET", "/triggers/deliveries").json()
        assert "count" in body
        assert "deliveries" in body
        assert isinstance(body["deliveries"], list)
        assert body["count"] == len(body["deliveries"])

    def test_query_deliveries_returns_200(self, authed_api):
        response = authed_api("POST", "/triggers/deliveries/query", json={})
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == len(body["deliveries"])

    def test_fetch_unknown_delivery_returns_404(self, authed_api):
        response = authed_api("GET", f"/triggers/deliveries/{uuid4()}")
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Full lifecycle (needs Composio) — create on a shared connection bound to a
# workflow, list/disable/delete it, and prove the connection survives (C7).
# ---------------------------------------------------------------------------


@_requires_composio
@_requires_connected_account
class TestTriggerSubscriptionsLifecycle:
    def _create_connection(self, authed_api):
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
        return create.json()["connection"]["id"]

    def test_create_list_disable_delete_keeps_connection(self, authed_api):
        connection_id = self._create_connection(authed_api)
        workflow_slug = _create_workflow(authed_api)

        # CREATE — binds the event to a workflow reference on the shared connection
        create = authed_api(
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
                        "references": {"workflow": {"slug": workflow_slug}},
                    },
                }
            },
        )
        assert create.status_code == 200, create.text
        sub = create.json()["subscription"]
        subscription_id = sub["id"]
        assert sub["connection_id"] == connection_id
        assert sub["trigger_id"] is not None
        assert sub["flags"]["is_active"] is True

        # LIST
        listing = authed_api("GET", "/triggers/subscriptions/").json()
        assert any(s["id"] == subscription_id for s in listing["subscriptions"])

        # DISABLE (revoke the subscription, not the connection)
        revoke = authed_api("POST", f"/triggers/subscriptions/{subscription_id}/revoke")
        assert revoke.status_code == 200, revoke.text
        assert revoke.json()["subscription"]["flags"]["is_active"] is False

        # DELETE
        delete = authed_api("DELETE", f"/triggers/subscriptions/{subscription_id}")
        assert delete.status_code == 204

        fetch = authed_api("GET", f"/triggers/subscriptions/{subscription_id}")
        assert fetch.status_code == 404

        # C7: deleting the subscription must NOT delete/revoke the connection.
        conn = authed_api("GET", f"/tools/connections/{connection_id}")
        assert conn.status_code == 200, conn.text

        authed_api("DELETE", f"/tools/connections/{connection_id}")
