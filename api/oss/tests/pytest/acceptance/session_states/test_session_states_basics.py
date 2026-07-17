"""Acceptance tests for /sessions/states/ endpoints (OSS edition).

Post-merge (S1/S8): /sessions/states/ is the header surface over the merged
session_streams row. GET reads {name, description, flags, ...}; PUT/POST is the
rename edit, a full-PUT of {name, description}. There is no more data/sandbox_id
RMW blob -- that lived in session_states, now superseded.
"""

import uuid


class TestSessionStatesBasics:
    """GET / PUT / POST /sessions/states/?session_id=... — happy paths."""

    def test_get_missing_state_returns_empty(self, authed_api):
        session_id = str(uuid.uuid4())
        response = authed_api(
            "GET", "/sessions/states/", params={"session_id": session_id}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 0
        assert body.get("session_state") is None

    def test_put_renames_and_creates_row(self, authed_api):
        session_id = str(uuid.uuid4())
        payload = {"name": "My Session", "description": "A test session."}

        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json=payload,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        state = body["session_state"]
        assert state["session_id"] == session_id
        assert state["name"] == "My Session"
        assert state["description"] == "A test session."

    def test_get_returns_persisted_rename(self, authed_api):
        session_id = str(uuid.uuid4())
        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"name": "Persisted Name"},
        )

        response = authed_api(
            "GET", "/sessions/states/", params={"session_id": session_id}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["session_state"]["session_id"] == session_id
        assert body["session_state"]["name"] == "Persisted Name"

    def test_put_upserts_on_second_call(self, authed_api):
        session_id = str(uuid.uuid4())

        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"name": "First"},
        )

        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"name": "Second", "description": "updated"},
        )
        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["name"] == "Second"
        assert state["description"] == "updated"

        get_resp = authed_api(
            "GET", "/sessions/states/", params={"session_id": session_id}
        )
        assert get_resp.json()["session_state"]["name"] == "Second"

    def test_post_also_accepts_the_rename_edit(self, authed_api):
        session_id = str(uuid.uuid4())
        response = authed_api(
            "POST",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"name": "Via POST"},
        )
        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["session_id"] == session_id
        assert state["name"] == "Via POST"

    def test_invalid_session_id_rejected(self, authed_api):
        # slashes are not allowed
        response = authed_api(
            "GET", "/sessions/states/", params={"session_id": "foo/bar"}
        )
        assert response.status_code == 400

    def test_invalid_session_id_chars_rejected(self, authed_api):
        # spaces are not allowed
        response = authed_api(
            "GET", "/sessions/states/", params={"session_id": "foo bar"}
        )
        assert response.status_code == 400
