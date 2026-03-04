"""Acceptance tests for the events query endpoint.

Requires a running API.  These tests verify the API contract (shape, status
codes, filtering) without making strong assumptions about how many events
exist in the system at query time — the events worker is a separate process.
"""


class TestEventsBasics:
    def test_query_events_returns_valid_response(self, authed_api):
        """POST /events/query with an empty body returns a valid response."""
        # ACT ------------------------------------------------------------------
        response = authed_api("POST", "/events/query", json={})
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert "count" in body
        assert "events" in body
        assert isinstance(body["events"], list)
        assert body["count"] == len(body["events"])
        # ----------------------------------------------------------------------

    def test_query_events_by_event_type(self, authed_api):
        """Filtering by event_type returns only matching events."""
        # ACT ------------------------------------------------------------------
        response = authed_api(
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

    def test_query_events_by_unknown_event_type(self, authed_api):
        """Filtering by UNKNOWN event_type returns only unknown events."""
        # ACT ------------------------------------------------------------------
        response = authed_api(
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

    def test_query_events_with_windowing_limit(self, authed_api):
        """Windowing limit=1 returns at most 1 event."""
        # ACT ------------------------------------------------------------------
        response = authed_api(
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

    def test_query_events_invalid_event_type_rejected(self, authed_api):
        """Sending an unrecognised event_type value should be rejected (422)."""
        # ACT ------------------------------------------------------------------
        response = authed_api(
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
