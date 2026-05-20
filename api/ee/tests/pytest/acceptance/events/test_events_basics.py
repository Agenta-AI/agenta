"""EE acceptance tests for the events query endpoint.

Mirrors the OSS suite (oss/tests/pytest/acceptance/events/test_events_basics.py)
but exercises /events/query as a business-plan, developer-role account. Under EE
the endpoint is gated on the AUDIT entitlement and the VIEW_EVENTS permission, so
a basic Hobby-plan account is rejected with 403 (which is why the OSS suite is
skipped on EE). This suite uses a business-plan developer account — which has the
AUDIT entitlement and VIEW_EVENTS — to verify the endpoint behaves correctly once
the gate is satisfied.

Requires a running API. These tests verify the API contract (shape, status
codes, filtering) without making strong assumptions about how many events
exist at query time — the events worker is a separate process.
"""

from uuid import uuid4

import pytest
import requests

from utils.constants import BASE_TIMEOUT


def _create_developer_business_account(admin_api):
    uid = uuid4().hex[:12]
    email = f"events-dev-{uid}@test.agenta.ai"
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
def events_api(admin_api, ag_env):
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


class TestEventsBasics:
    def test_query_events_returns_valid_response(self, events_api):
        """POST /events/query with an empty body returns a valid response."""
        # ACT ------------------------------------------------------------------
        response = events_api("POST", "/events/query", json={})
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert "count" in body
        assert "events" in body
        assert isinstance(body["events"], list)
        assert body["count"] == len(body["events"])
        # ----------------------------------------------------------------------

    def test_query_events_by_event_type(self, events_api):
        """Filtering by event_type returns only matching events."""
        # ACT ------------------------------------------------------------------
        response = events_api(
            "POST",
            "/events/query",
            json={
                "event": {"event_type": "environments.revisions.committed"},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert "count" in body
        assert "events" in body
        # Every returned event must match the requested type
        for event in body["events"]:
            assert event["event_type"] == "environments.revisions.committed"
        # ----------------------------------------------------------------------

    def test_query_events_by_unknown_event_type(self, events_api):
        """Filtering by UNKNOWN event_type returns only unknown events."""
        # ACT ------------------------------------------------------------------
        response = events_api(
            "POST",
            "/events/query",
            json={
                "event": {"event_type": "unknown"},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        for event in body["events"]:
            assert event["event_type"] == "unknown"
        # ----------------------------------------------------------------------

    def test_query_events_with_windowing_limit(self, events_api):
        """Windowing limit=1 returns at most 1 event."""
        # ACT ------------------------------------------------------------------
        response = events_api(
            "POST",
            "/events/query",
            json={"windowing": {"limit": 1}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] <= 1
        assert len(body["events"]) <= 1
        # ----------------------------------------------------------------------

    def test_query_events_invalid_event_type_rejected(self, events_api):
        """Sending an unrecognised event_type value should be rejected (422)."""
        # ACT ------------------------------------------------------------------
        response = events_api(
            "POST",
            "/events/query",
            json={
                "event": {"event_type": "not.a.real.event.type"},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 422
        # ----------------------------------------------------------------------
