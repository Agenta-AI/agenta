"""Acceptance tests for webhook subscription query operations.

Requires a running API.
"""

from uuid import uuid4

import pytest


# ---------------------------------------------------------------------------
# Shared fixture: two subscriptions (one archived)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE ------------------------------------------------------------------
    marker = uuid4().hex[:8]

    payload_a = {
        "subscription": {
            "name": f"Webhook-A {marker}",
            "description": "First test subscription",
            "data": {
                "url": "https://example.com/hook-a",
                "event_types": ["environments.revisions.committed"],
            },
            "flags": {"is_active": True},
            "tags": {"_marker": marker, "kind": "A"},
        }
    }
    payload_b = {
        "subscription": {
            "name": f"Webhook-B {marker}",
            "description": "Second test subscription",
            "data": {
                "url": "https://example.com/hook-b",
                "event_types": ["webhooks.subscriptions.tested"],
            },
            "flags": {"is_active": False},
            "tags": {"_marker": marker, "kind": "B"},
        }
    }

    resp_a = authed_api("POST", "/webhooks/", json=payload_a)
    assert resp_a.status_code == 200
    sub_a = resp_a.json()["subscription"]

    resp_b = authed_api("POST", "/webhooks/", json=payload_b)
    assert resp_b.status_code == 200
    sub_b = resp_b.json()["subscription"]

    # Archive sub_b so we have one active and one archived
    arch_resp = authed_api("POST", f"/webhooks/{sub_b['id']}/archive")
    assert arch_resp.status_code == 200

    # Verify setup via marker-scoped query
    query_resp = authed_api(
        "POST",
        "/webhooks/query",
        json={
            "include_archived": True,
            "subscription": {"tags": {"_marker": marker}},
        },
    )
    assert query_resp.status_code == 200
    assert query_resp.json()["count"] == 2
    # --------------------------------------------------------------------------

    return {
        "subscriptions": [sub_a, sub_b],
        "_marker": marker,
    }


# ---------------------------------------------------------------------------
# TestWebhooksSubscriptionsQueries
# ---------------------------------------------------------------------------


class TestWebhooksSubscriptionsQueries:
    def test_query_non_archived_subscriptions(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/webhooks/query",
            json={
                "subscription": {"tags": {"_marker": mock_data["_marker"]}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        # Only the active (non-archived) subscription should be returned
        assert body["count"] == 1
        assert body["subscriptions"][0]["id"] == mock_data["subscriptions"][0]["id"]
        # ----------------------------------------------------------------------

    def test_query_all_subscriptions_including_archived(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/webhooks/query",
            json={
                "include_archived": True,
                "subscription": {"tags": {"_marker": mock_data["_marker"]}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 2
        returned_ids = {s["id"] for s in body["subscriptions"]}
        assert mock_data["subscriptions"][0]["id"] in returned_ids
        assert mock_data["subscriptions"][1]["id"] in returned_ids
        # ----------------------------------------------------------------------

    def test_query_subscriptions_by_flags(self, authed_api, mock_data):
        marker = mock_data["_marker"]

        # ACT — filter for active subscriptions --------------------------------
        response = authed_api(
            "POST",
            "/webhooks/query",
            json={
                "include_archived": True,
                "subscription": {
                    "tags": {"_marker": marker},
                    "flags": {"is_active": True},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["subscriptions"][0]["id"] == mock_data["subscriptions"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT — filter for inactive subscriptions ------------------------------
        response = authed_api(
            "POST",
            "/webhooks/query",
            json={
                "include_archived": True,
                "subscription": {
                    "tags": {"_marker": marker},
                    "flags": {"is_active": False},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["subscriptions"][0]["id"] == mock_data["subscriptions"][1]["id"]
        # ----------------------------------------------------------------------

    def test_query_subscriptions_by_tags(self, authed_api, mock_data):
        marker = mock_data["_marker"]

        # ACT — match only subscription A by its unique tag value --------------
        response = authed_api(
            "POST",
            "/webhooks/query",
            json={
                "include_archived": True,
                "subscription": {"tags": {"_marker": marker, "kind": "A"}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["subscriptions"][0]["id"] == mock_data["subscriptions"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT — no match for non-existent tag value ----------------------------
        response = authed_api(
            "POST",
            "/webhooks/query",
            json={
                "subscription": {"tags": {"_marker": marker, "kind": "nonexistent"}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 0
        # ----------------------------------------------------------------------

    def test_query_subscriptions_paginated(self, authed_api, mock_data):
        marker = mock_data["_marker"]
        expected_ids = {s["id"] for s in mock_data["subscriptions"]}

        # ACT — page 1 ---------------------------------------------------------
        response = authed_api(
            "POST",
            "/webhooks/query",
            json={
                "include_archived": True,
                "subscription": {"tags": {"_marker": marker}},
                "windowing": {"limit": 1},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        seen_ids = {body["subscriptions"][0]["id"]}
        first_id = body["subscriptions"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT — page 2 ---------------------------------------------------------
        response = authed_api(
            "POST",
            "/webhooks/query",
            json={
                "include_archived": True,
                "subscription": {"tags": {"_marker": marker}},
                "windowing": {"limit": 1, "next": first_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        seen_ids.add(body["subscriptions"][0]["id"])
        assert seen_ids == expected_ids
        # ----------------------------------------------------------------------

        # ACT — page 3 (empty) -------------------------------------------------
        last_id = body["subscriptions"][0]["id"]
        response = authed_api(
            "POST",
            "/webhooks/query",
            json={
                "include_archived": True,
                "subscription": {"tags": {"_marker": marker}},
                "windowing": {"limit": 1, "next": last_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 0
        # ----------------------------------------------------------------------

    def test_query_empty_returns_valid_response(self, authed_api):
        # ACT — completely empty query body ------------------------------------
        response = authed_api("POST", "/webhooks/query", json={})
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert "count" in body
        assert "subscriptions" in body
        assert isinstance(body["subscriptions"], list)
        # ----------------------------------------------------------------------
