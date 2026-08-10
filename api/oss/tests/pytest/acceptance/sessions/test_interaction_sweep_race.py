"""Acceptance coverage for the atomic interaction-answer ordering guarantee.

Requires a live stack through the shared ``authed_api`` fixture. The answered row and an
unanswered control share one stale sweep so the test proves both that the sweep ran and that its
``pending`` filter protects an answer recorded as ``responded``.
"""

from uuid import uuid4


def _create_client_tool(authed_api, *, session_id: str, turn_id: str, token: str):
    response = authed_api(
        "POST",
        "/sessions/interactions/",
        json={
            "session_id": session_id,
            "turn_id": turn_id,
            "token": token,
            "kind": "client_tool",
            "data": {
                "request": {
                    "tool": "request_connection",
                    "tool_call_id": f"call-{token}",
                }
            },
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["interaction"]


def _fetch(authed_api, interaction_id: str):
    response = authed_api("GET", f"/sessions/interactions/{interaction_id}")
    assert response.status_code == 200, response.text
    return response.json()["interaction"]


class TestInteractionSweepRace:
    def test_answered_row_is_invisible_to_later_turn_sweep(self, authed_api):
        session_id = str(uuid4())
        answered_token = f"answered-{uuid4().hex}"
        pending_token = f"pending-{uuid4().hex}"
        answered = _create_client_tool(
            authed_api,
            session_id=session_id,
            turn_id="turn-1",
            token=answered_token,
        )
        pending = _create_client_tool(
            authed_api,
            session_id=session_id,
            turn_id="turn-2",
            token=pending_token,
        )
        resolution = {
            "tool_call_id": f"call-{answered_token}",
            "tool_name": "request_connection",
            "outcome": "completed",
            "output": {"connected": True, "integration": "telegram"},
        }

        transition = authed_api(
            "POST",
            "/sessions/interactions/transition",
            json={
                "session_id": session_id,
                "token": answered_token,
                "status": "responded",
                "resolution": resolution,
            },
        )
        assert transition.status_code == 200, transition.text
        transitioned = transition.json()["interaction"]
        assert transitioned["status"] == "responded"
        assert transitioned["data"]["resolution"] == resolution

        sweep = authed_api(
            "POST",
            "/sessions/interactions/cancel-stale",
            json={"session_id": session_id, "turn_id": "turn-3"},
        )
        assert sweep.status_code == 200, sweep.text
        assert sweep.json()["cancelled"] == 1

        answered_after = _fetch(authed_api, answered["id"])
        pending_after = _fetch(authed_api, pending["id"])
        assert answered_after["status"] == "responded"
        assert answered_after["data"]["resolution"] == resolution
        assert pending_after["status"] == "cancelled"
        assert pending_after.get("data", {}).get("resolution") is None
