"""Acceptance tests for the events query endpoint.

Requires a running API.  These tests verify the API contract (shape, status
codes, filtering) without making strong assumptions about how many events
exist in the system at query time — the events worker is a separate process.

These exercise the *ungated* OSS contract, where a basic account may query
events freely. Under EE the same endpoint is gated on the AUDIT entitlement
(Hobby plan lacks it) and the VIEW_EVENTS permission, so a basic account is
correctly rejected with 403. That gated behaviour is covered by the EE suite
(ee/tests/pytest/acceptance/events/test_events_basics.py) using a business-plan
developer account, so this OSS suite is skipped on EE deployments.
"""

import os

import pytest
import requests

from utils.constants import BASE_TIMEOUT


@pytest.fixture(scope="class")
def events_api(cls_account, ag_env):
    if os.getenv("AGENTA_LICENSE") == "ee":
        pytest.skip(
            "Endpoint is plan/role-gated under EE; covered by the EE events suite."
        )

    credentials = cls_account["credentials"]

    def _request(method: str, endpoint: str, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", credentials)
        return requests.request(
            method=method,
            url=f"{ag_env['api_url']}{endpoint}",
            headers=headers,
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    yield _request


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
