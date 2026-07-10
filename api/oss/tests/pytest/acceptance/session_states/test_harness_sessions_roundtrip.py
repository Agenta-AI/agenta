"""Acceptance tests for the S2/S2b/S4 durable continuity state on /sessions/states/ and
/sessions/mounts/sign (OSS edition). Follows test_session_states_basics.py's setup exactly.

The continuity fields (latest_agent_session_id / harness_sessions / latest_turn_index) live
inside the existing `data` JSON column, so NO migration is required -- `session_states.data`
already exists.

NOT RUN in this pass: requires a live stack (AGENTA_API_URL/AGENTA_AUTH_KEY). A running
docker-compose stack was found locally but its image predates this change, so these are
delivered unrun -- see the pytest.ini `acceptance` marker.
"""

import uuid


class TestHarnessSessionsRoundtrip:
    """GET/PUT /sessions/states/ round-trips data.{latest_agent_session_id,
    harness_sessions, latest_turn_index}; POST /sessions/mounts/sign accepts
    name=claude-projects."""

    def test_put_get_roundtrips_harness_sessions(self, authed_api):
        session_id = str(uuid.uuid4())
        data = {
            "latest_agent_session_id": "agent-claude-2",
            "harness_sessions": {
                "claude": {
                    "agent_session_id": "agent-claude-2",
                    "turn_index": 2,
                },
                "pi": {
                    "agent_session_id": "agent-pi-1",
                    "turn_index": 1,
                },
            },
            "latest_turn_index": 2,
        }

        put_response = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={"data": data},
        )
        assert put_response.status_code == 200
        put_state = put_response.json()["session_state"]
        assert put_state["data"]["latest_agent_session_id"] == "agent-claude-2"
        assert put_state["data"]["latest_turn_index"] == 2
        assert put_state["data"]["harness_sessions"] == data["harness_sessions"]

        get_response = authed_api(
            "GET", "/sessions/states/", params={"session_id": session_id}
        )
        assert get_response.status_code == 200
        get_state = get_response.json()["session_state"]
        assert get_state["data"]["latest_agent_session_id"] == "agent-claude-2"
        assert get_state["data"]["latest_turn_index"] == 2
        assert get_state["data"]["harness_sessions"] == data["harness_sessions"]

    def test_harness_sessions_survive_a_read_modify_write_merge(self, authed_api):
        # Mirrors the runner's syncHarnessSessionDurable: GET, splice one harness's entry,
        # PUT the whole data back -- the other harness's entry must survive untouched.
        session_id = str(uuid.uuid4())
        authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={
                "data": {
                    "harness_sessions": {
                        "pi": {
                            "agent_session_id": "agent-pi-1",
                            "turn_index": 1,
                        },
                    },
                    "latest_turn_index": 1,
                },
            },
        )

        merged = authed_api(
            "PUT",
            "/sessions/states/",
            params={"session_id": session_id},
            json={
                "data": {
                    "latest_agent_session_id": "agent-claude-2",
                    "harness_sessions": {
                        "pi": {
                            "agent_session_id": "agent-pi-1",
                            "turn_index": 1,
                        },
                        "claude": {
                            "agent_session_id": "agent-claude-2",
                            "turn_index": 2,
                        },
                    },
                    "latest_turn_index": 2,
                },
            },
        )
        assert merged.status_code == 200
        state = merged.json()["session_state"]
        assert state["data"]["harness_sessions"]["pi"]["turn_index"] == 1
        assert state["data"]["harness_sessions"]["claude"]["turn_index"] == 2

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
