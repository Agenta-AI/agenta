"""Acceptance tests for the S1/S8 stream-merge header edit on /sessions/states/
and /sessions/mounts/sign (OSS edition).

Pre-merge, this file exercised session_states.data (harness_sessions RMW). That
surface is retired: session_states is superseded by the session_streams header
(name/description). PUT /sessions/states/ is now the rename edit -- a full-PUT
of {name, description} -- and GET reads it back. See W2.5's round-trip test.

Requires a live stack (AGENTA_API_URL/AGENTA_AUTH_KEY) -- see the pytest.ini
`acceptance` marker.
"""

import uuid


class TestSessionHeaderRoundtrip:
    """GET/PUT /sessions/states/ round-trips {name, description}; POST
    /sessions/mounts/sign accepts name=claude-projects."""

    def test_rename_persists_and_round_trips_via_get(self, authed_api):
        session_id = str(uuid.uuid4())

        put_response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"name": "Renamed Session", "description": "roundtrip check"},
        )
        assert put_response.status_code == 200
        put_state = put_response.json()["session_state"]
        assert put_state["name"] == "Renamed Session"
        assert put_state["description"] == "roundtrip check"

        get_response = authed_api(
            "GET", "/sessions/states/", params={"session_id": session_id}
        )
        assert get_response.status_code == 200
        get_state = get_response.json()["session_state"]
        assert get_state["name"] == "Renamed Session"
        assert get_state["description"] == "roundtrip check"

    def test_rename_is_a_full_put_partial_fields_preserved(self, authed_api):
        # A second PUT that sends only `name` must not clear `description` --
        # exclude_unset means an omitted field is untouched, not nulled.
        session_id = str(uuid.uuid4())
        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"name": "First", "description": "keep me"},
        )

        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"name": "Second"},
        )
        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["name"] == "Second"
        assert state["description"] == "keep me"

    def test_mounts_sign_accepts_claude_projects_name(self, authed_api):
        session_id = str(uuid.uuid4())
        response = authed_api(
            "POST",
            "/sessions/mounts/sign",
            params={"session_id": session_id, "name": "claude-projects"},
        )
        # 200 with usable credentials, or 503 if the store is not configured in this
        # environment -- either is a legitimate outcome; the endpoint must not 4xx/500 on a
        # valid `name` value.
        assert response.status_code in (200, 503)
        if response.status_code == 200:
            body = response.json()
            assert body["mount"]["name"] == "claude-projects"
