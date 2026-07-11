"""Acceptance tests for /sessions/states/ endpoints (OSS edition)."""

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

    def test_put_creates_state(self, authed_api):
        session_id = str(uuid.uuid4())
        payload = {
            "data": {"latest_agent_session_id": "agent-abc"},
            "sandbox_id": "sandbox-001",
        }

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
        assert state["data"]["latest_agent_session_id"] == "agent-abc"
        assert state["sandbox_id"] == "sandbox-001"

    def test_get_returns_persisted_state(self, authed_api):
        session_id = str(uuid.uuid4())
        payload = {
            "data": {"latest_agent_session_id": "agent-abc"},
            "sandbox_id": "sbx-999",
        }

        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json=payload,
        )

        response = authed_api(
            "GET", "/sessions/states/", params={"session_id": session_id}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["session_state"]["session_id"] == session_id
        assert body["session_state"]["sandbox_id"] == "sbx-999"

    def test_put_upserts_on_second_call(self, authed_api):
        session_id = str(uuid.uuid4())

        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"data": {"latest_turn_index": 1}},
        )

        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"data": {"latest_turn_index": 2}, "sandbox_id": "sbx-v2"},
        )
        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["data"]["latest_turn_index"] == 2
        assert state["sandbox_id"] == "sbx-v2"

        # GET should reflect the latest upsert
        get_resp = authed_api(
            "GET", "/sessions/states/", params={"session_id": session_id}
        )
        assert get_resp.json()["session_state"]["data"]["latest_turn_index"] == 2

    def test_set_sandbox_id_endpoint(self, authed_api):
        session_id = str(uuid.uuid4())

        # create the state first
        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"data": {"latest_agent_session_id": "agent-abc"}},
        )

        # update sandbox_id independently
        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"sandbox_id": "sbx-new"},
        )
        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["sandbox_id"] == "sbx-new"
        assert state["data"] == {"latest_agent_session_id": "agent-abc"}

    def test_set_sandbox_id_clear(self, authed_api):
        session_id = str(uuid.uuid4())

        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"data": {}, "sandbox_id": "sbx-to-clear"},
        )

        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"sandbox_id": None},
        )
        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state.get("sandbox_id") is None

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

    def test_sandbox_id_on_missing_state_creates_state(self, authed_api):
        session_id = str(uuid.uuid4())
        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"sandbox_id": "sbx-orphan"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        state = body["session_state"]
        assert state["session_id"] == session_id
        assert state["sandbox_id"] == "sbx-orphan"
        assert state.get("data") is None

    def test_sandbox_id_update_preserves_existing_data(self, authed_api):
        session_id = str(uuid.uuid4())
        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={
                "data": {
                    "latest_turn_index": 1,
                    "latest_agent_session_id": "agent-abc",
                }
            },
        )

        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"sandbox_id": "sbx-preserved"},
        )

        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["sandbox_id"] == "sbx-preserved"
        assert state["data"] == {
            "latest_turn_index": 1,
            "latest_agent_session_id": "agent-abc",
        }

    def test_sandbox_id_accepts_runner_post(self, authed_api):
        session_id = str(uuid.uuid4())
        response = authed_api(
            "POST",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"sandbox_id": "sbx-runner"},
        )

        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["session_id"] == session_id
        assert state["sandbox_id"] == "sbx-runner"

    def test_guarded_pointer_write_applies_at_latest_turn(self, authed_api):
        session_id = str(uuid.uuid4())
        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={
                "data": {"latest_turn_index": 2},
                "sandbox_id": "sbx-old",
                "sandbox_fingerprint": "fingerprint-old",
            },
        )

        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={
                "sandbox_id": "sbx-new",
                "sandbox_fingerprint": "fingerprint-new",
                "sandbox_turn_index": 2,
            },
        )

        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["sandbox_id"] == "sbx-new"
        assert state["sandbox_fingerprint"] == "fingerprint-new"

    def test_stale_guarded_pointer_write_returns_unchanged_row(self, authed_api):
        session_id = str(uuid.uuid4())
        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={
                "data": {"latest_turn_index": 3},
                "sandbox_id": "sbx-current",
                "sandbox_fingerprint": "fingerprint-current",
            },
        )

        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={
                "sandbox_id": "sbx-stale",
                "sandbox_fingerprint": "fingerprint-stale",
                "sandbox_turn_index": 2,
            },
        )

        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["sandbox_id"] == "sbx-current"
        assert state["sandbox_fingerprint"] == "fingerprint-current"
        assert state["data"]["latest_turn_index"] == 3

    def test_tokenless_pointer_write_remains_unconditional(self, authed_api):
        session_id = str(uuid.uuid4())
        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={
                "data": {"latest_turn_index": 4},
                "sandbox_id": "sbx-old",
                "sandbox_fingerprint": "fingerprint-old",
            },
        )

        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={
                "sandbox_id": "sbx-tokenless",
                "sandbox_fingerprint": "fingerprint-tokenless",
            },
        )

        state = response.json()["session_state"]
        assert state["sandbox_id"] == "sbx-tokenless"
        assert state["sandbox_fingerprint"] == "fingerprint-tokenless"

    def test_sandbox_fingerprint_round_trips_with_sandbox_id(self, authed_api):
        session_id = str(uuid.uuid4())
        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={
                "sandbox_id": "sbx-fingerprint",
                "sandbox_fingerprint": "fingerprint-123",
            },
        )

        response = authed_api(
            "GET", "/sessions/states/", params={"session_id": session_id}
        )

        state = response.json()["session_state"]
        assert state["sandbox_id"] == "sbx-fingerprint"
        assert state["sandbox_fingerprint"] == "fingerprint-123"

    def test_guarded_pointer_write_creates_missing_row(self, authed_api):
        session_id = str(uuid.uuid4())
        response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={
                "sandbox_id": "sbx-first",
                "sandbox_fingerprint": "fingerprint-first",
                "sandbox_turn_index": 7,
            },
        )

        assert response.status_code == 200
        state = response.json()["session_state"]
        assert state["sandbox_id"] == "sbx-first"
        assert state["sandbox_fingerprint"] == "fingerprint-first"
        assert state.get("data") is None
