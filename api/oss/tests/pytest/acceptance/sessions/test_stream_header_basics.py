"""Acceptance tests for the session header surface on /sessions/streams/ (OSS edition).

GET /sessions/streams/ reads the merged stream row {name, description, flags, ...};
PUT/POST /sessions/streams/header is the rename edit, a full-PUT of {name, description}.
"""

import uuid


class TestSessionStreamHeaderBasics:
    """GET /sessions/streams/ + PUT/POST /sessions/streams/header — happy paths."""

    def test_get_missing_stream_returns_empty(self, authed_api):
        session_id = str(uuid.uuid4())
        response = authed_api(
            "GET", "/sessions/streams/", params={"session_id": session_id}
        )
        assert response.status_code == 200
        body = response.json()
        assert body.get("stream") is None

    def test_put_renames_and_creates_row(self, authed_api):
        session_id = str(uuid.uuid4())
        payload = {"name": "My Session", "description": "A test session."}

        response = authed_api(
            "PUT",
            "/sessions/streams/header",
            params={"session_id": session_id},
            json=payload,
        )
        assert response.status_code == 200
        stream = response.json()["stream"]
        assert stream["session_id"] == session_id
        assert stream["name"] == "My Session"
        assert stream["description"] == "A test session."

    def test_get_returns_persisted_rename(self, authed_api):
        session_id = str(uuid.uuid4())
        authed_api(
            "PUT",
            "/sessions/streams/header",
            params={"session_id": session_id},
            json={"name": "Persisted Name"},
        )

        response = authed_api(
            "GET", "/sessions/streams/", params={"session_id": session_id}
        )
        assert response.status_code == 200
        stream = response.json()["stream"]
        assert stream["session_id"] == session_id
        assert stream["name"] == "Persisted Name"

    def test_put_upserts_on_second_call(self, authed_api):
        session_id = str(uuid.uuid4())

        authed_api(
            "PUT",
            "/sessions/streams/header",
            params={"session_id": session_id},
            json={"name": "First"},
        )

        response = authed_api(
            "PUT",
            "/sessions/streams/header",
            params={"session_id": session_id},
            json={"name": "Second", "description": "updated"},
        )
        assert response.status_code == 200
        stream = response.json()["stream"]
        assert stream["name"] == "Second"
        assert stream["description"] == "updated"

        get_resp = authed_api(
            "GET", "/sessions/streams/", params={"session_id": session_id}
        )
        assert get_resp.json()["stream"]["name"] == "Second"

    def test_post_also_accepts_the_rename_edit(self, authed_api):
        session_id = str(uuid.uuid4())
        response = authed_api(
            "POST",
            "/sessions/streams/header",
            params={"session_id": session_id},
            json={"name": "Via POST"},
        )
        assert response.status_code == 200
        stream = response.json()["stream"]
        assert stream["session_id"] == session_id
        assert stream["name"] == "Via POST"

    def test_invalid_session_id_rejected(self, authed_api):
        # slashes are not allowed
        response = authed_api(
            "GET", "/sessions/streams/", params={"session_id": "foo/bar"}
        )
        assert response.status_code == 400

    def test_invalid_session_id_chars_rejected(self, authed_api):
        # spaces are not allowed
        response = authed_api(
            "GET", "/sessions/streams/", params={"session_id": "foo bar"}
        )
        assert response.status_code == 400
