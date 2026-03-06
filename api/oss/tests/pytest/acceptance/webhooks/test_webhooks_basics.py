"""Acceptance tests for webhook subscription and delivery CRUD operations.

Requires a running API.  Each test class gets its own isolated account via the
class-scoped ``authed_api`` fixture so tests are self-contained.
"""

from uuid import uuid4


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _subscription_payload(*, name=None, url="https://example.com/hook"):
    slug = uuid4().hex[:8]
    return {
        "subscription": {
            "name": name or f"Test Webhook {slug}",
            "description": "Acceptance test subscription",
            "data": {
                "url": url,
                "event_types": ["environments.revisions.committed"],
            },
            "flags": {
                "is_active": True,
            },
        }
    }


# ---------------------------------------------------------------------------
# TestWebhooksSubscriptionsBasics
# ---------------------------------------------------------------------------


class TestWebhooksSubscriptionsBasics:
    def test_create_webhook_subscription(self, authed_api):
        # ACT ------------------------------------------------------------------
        response = authed_api("POST", "/webhooks/", json=_subscription_payload())
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        sub = body["subscription"]
        assert sub["id"] is not None
        assert sub["secret"] is not None and len(sub["secret"]) > 0
        assert sub["data"]["event_types"] == ["environments.revisions.committed"]
        # ----------------------------------------------------------------------

    def test_fetch_webhook_subscription(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        create_resp = authed_api("POST", "/webhooks/", json=_subscription_payload())
        assert create_resp.status_code == 200
        subscription_id = create_resp.json()["subscription"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api("GET", f"/webhooks/{subscription_id}")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["subscription"]["id"] == subscription_id
        # ----------------------------------------------------------------------

    def test_fetch_webhook_subscription_not_found(self, authed_api):
        # ACT ------------------------------------------------------------------
        response = authed_api("GET", f"/webhooks/{uuid4()}")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 404
        # ----------------------------------------------------------------------

    def test_edit_webhook_subscription(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        create_resp = authed_api("POST", "/webhooks/", json=_subscription_payload())
        assert create_resp.status_code == 200
        subscription = create_resp.json()["subscription"]
        subscription_id = subscription["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "PUT",
            f"/webhooks/{subscription_id}",
            json={
                "subscription": {
                    "id": subscription_id,
                    "name": "Updated Webhook Name",
                    "description": "Updated description",
                    "data": {
                        "url": "https://example.com/updated-hook",
                        "event_types": [
                            "environments.revisions.committed",
                            "webhooks.subscriptions.tested",
                        ],
                    },
                    "flags": {
                        "is_active": False,
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        updated = body["subscription"]
        assert updated["name"] == "Updated Webhook Name"
        assert updated["flags"]["is_active"] is False
        assert len(updated["data"]["event_types"]) == 2
        # ----------------------------------------------------------------------

    def test_edit_webhook_subscription_id_mismatch(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        create_resp = authed_api("POST", "/webhooks/", json=_subscription_payload())
        assert create_resp.status_code == 200
        subscription_id = create_resp.json()["subscription"]["id"]
        # ----------------------------------------------------------------------

        # ACT — body id differs from path id ----------------------------------
        response = authed_api(
            "PUT",
            f"/webhooks/{subscription_id}",
            json={
                "subscription": {
                    "id": str(uuid4()),  # deliberately different
                    "name": "Should Fail",
                    "data": {"url": "https://example.com/hook"},
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 400
        # ----------------------------------------------------------------------

    def test_delete_webhook_subscription(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        create_resp = authed_api("POST", "/webhooks/", json=_subscription_payload())
        assert create_resp.status_code == 200
        subscription_id = create_resp.json()["subscription"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api("DELETE", f"/webhooks/{subscription_id}")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 204

        fetch_resp = authed_api("GET", f"/webhooks/{subscription_id}")
        assert fetch_resp.status_code == 404
        # ----------------------------------------------------------------------

    def test_delete_webhook_subscription_not_found(self, authed_api):
        # ACT ------------------------------------------------------------------
        response = authed_api("DELETE", f"/webhooks/{uuid4()}")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 404
        # ----------------------------------------------------------------------


# ---------------------------------------------------------------------------
# TestWebhooksSubscriptionsAuthMode
# ---------------------------------------------------------------------------


class TestWebhooksSubscriptionsAuthMode:
    def test_create_subscription_with_signature_mode(self, authed_api):
        """Explicit signature mode works and auto-generates a secret."""
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/webhooks/",
            json={
                "subscription": {
                    "name": f"sig-{uuid4().hex[:8]}",
                    "data": {
                        "url": "https://example.com/hook",
                        "auth_mode": "signature",
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        sub = response.json()["subscription"]
        assert sub["secret"] is not None
        assert sub["data"]["auth_mode"] == "signature"
        # ----------------------------------------------------------------------

    def test_create_subscription_with_authorization_mode_and_secret(self, authed_api):
        """Authorization mode with a user-provided secret stores that secret."""
        user_secret = "my-custom-bearer-token-xyz"

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/webhooks/",
            json={
                "subscription": {
                    "name": f"auth-{uuid4().hex[:8]}",
                    "data": {
                        "url": "https://example.com/hook",
                        "auth_mode": "authorization",
                    },
                    "secret": user_secret,
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        sub = response.json()["subscription"]
        assert sub["secret"] == user_secret
        assert sub["data"]["auth_mode"] == "authorization"
        # ----------------------------------------------------------------------

    def test_create_subscription_with_authorization_mode_without_secret_fails(
        self, authed_api
    ):
        """Authorization mode without a secret must be rejected with 400."""
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/webhooks/",
            json={
                "subscription": {
                    "name": f"auth-{uuid4().hex[:8]}",
                    "data": {
                        "url": "https://example.com/hook",
                        "auth_mode": "authorization",
                    },
                    # no secret provided
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 400
        # ----------------------------------------------------------------------


# ---------------------------------------------------------------------------
# TestWebhooksSubscriptionsPayloadFields
# ---------------------------------------------------------------------------


class TestWebhooksSubscriptionsPayloadFields:
    def test_create_subscription_with_payload_fields(self, authed_api):
        """payload_fields is persisted and returned on fetch."""
        payload_fields = {
            "event_type": "$.event.event_type",
            "project": "$.scope.project_id",
        }

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/webhooks/",
            json={
                "subscription": {
                    "name": f"pf-{uuid4().hex[:8]}",
                    "data": {
                        "url": "https://example.com/hook",
                        "payload_fields": payload_fields,
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        sub = response.json()["subscription"]
        assert sub["data"]["payload_fields"] == payload_fields
        # ----------------------------------------------------------------------

    def test_fetch_subscription_preserves_payload_fields(self, authed_api):
        """payload_fields is round-tripped through create → fetch."""
        payload_fields = {"ref": "$.event.attributes.ref"}

        create_resp = authed_api(
            "POST",
            "/webhooks/",
            json={
                "subscription": {
                    "name": f"pf-{uuid4().hex[:8]}",
                    "data": {
                        "url": "https://example.com/hook",
                        "payload_fields": payload_fields,
                    },
                }
            },
        )
        assert create_resp.status_code == 200
        subscription_id = create_resp.json()["subscription"]["id"]

        # ACT ------------------------------------------------------------------
        response = authed_api("GET", f"/webhooks/{subscription_id}")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        sub = response.json()["subscription"]
        assert sub["data"]["payload_fields"] == payload_fields
        # ----------------------------------------------------------------------
