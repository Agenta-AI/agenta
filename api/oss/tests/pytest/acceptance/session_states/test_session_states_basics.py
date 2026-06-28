"""Acceptance tests for /sessions/states/ endpoints (OSS edition)."""

import uuid


class TestSessionStatesBasics:
    """GET / PUT /sessions/states/{session_id} — happy paths."""

    def test_get_missing_state_returns_empty(self, authed_api):
        session_id = str(uuid.uuid4())
        response = authed_api("GET", f"/sessions/states/{session_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 0
        assert body.get("session_state") is None

    def test_put_creates_state(self, authed_api):
        session_id = str(uuid.uuid4())
        payload = {
            "data": {"localId": session_id, "agentSessionId": "agent-abc"},
            "sandbox_id": "sandbox-001",
        }

        response = authed_api("PUT", f"/sessions/states/{session_id}", json=payload)
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        state = body["session_state"]
        assert state["session_id"] == session_id
        assert state["data"]["agentSessionId"] == "agent-abc"
        assert state["sandbox_id"] == "sandbox-001"

    def test_get_returns_persisted_state(self, authed_api):
        session_id = str(uuid.uuid4())
        payload = {"data": {"localId": session_id}, "sandbox_id": "sbx-999"}

        authed_api("PUT", f"/sessions/states/{session_id}", json=payload)

        response = authed_api("GET", f"/sessions/states/{session_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["session_state"]["session_id"] == session_id
        assert body["session_state"]["sandbox_id"] == "sbx-999"

    def test_put_upserts_on_second_call(self, authed_api):
        session_id = str(uuid.uuid4())

        authed_api(
            "PUT",
            f"/sessions/states/{session_id}",
            json={"data": {"version": 1}},
        )

        response = authed_api(
            "PUT",
            f"/sessions/states/{session_id}",
            json={"data": {"version": 2}, "sandbox_id": "sbx-v2"},
        )
        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["data"]["version"] == 2
        assert state["sandbox_id"] == "sbx-v2"

        # GET should reflect the latest upsert
        get_resp = authed_api("GET", f"/sessions/states/{session_id}")
        assert get_resp.json()["session_state"]["data"]["version"] == 2

    def test_set_sandbox_id_endpoint(self, authed_api):
        session_id = str(uuid.uuid4())

        # create the state first
        authed_api(
            "PUT",
            f"/sessions/states/{session_id}",
            json={"data": {"localId": session_id}},
        )

        # update sandbox_id independently
        response = authed_api(
            "PUT",
            f"/sessions/states/{session_id}/sandbox-id",
            json={"sandbox_id": "sbx-new"},
        )
        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["sandbox_id"] == "sbx-new"

    def test_set_sandbox_id_clear(self, authed_api):
        session_id = str(uuid.uuid4())

        authed_api(
            "PUT",
            f"/sessions/states/{session_id}",
            json={"data": {}, "sandbox_id": "sbx-to-clear"},
        )

        response = authed_api(
            "PUT",
            f"/sessions/states/{session_id}/sandbox-id",
            json={"sandbox_id": None},
        )
        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state.get("sandbox_id") is None

    def test_invalid_session_id_rejected(self, authed_api):
        # slashes are not allowed
        response = authed_api("GET", "/sessions/states/foo/bar")
        # FastAPI will route this as /states/{session_id}/bar — no route exists
        assert response.status_code in (400, 404, 405)

    def test_invalid_session_id_chars_rejected(self, authed_api):
        # spaces are not allowed
        response = authed_api("GET", "/sessions/states/foo bar")
        assert response.status_code in (400, 422)

    def test_sandbox_id_on_missing_state_returns_empty(self, authed_api):
        session_id = str(uuid.uuid4())
        response = authed_api(
            "PUT",
            f"/sessions/states/{session_id}/sandbox-id",
            json={"sandbox_id": "sbx-orphan"},
        )
        assert response.status_code == 200
        body = response.json()
        # no row exists yet — service returns None
        assert body["count"] == 0
