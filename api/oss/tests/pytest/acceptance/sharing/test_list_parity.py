"""List and direct-read parity (M3, Review Focus 2), against a running API.

For each caller, every session and agent a list shows can be read directly, and every
one it can read directly is listed: the list scope (SQL) and the direct-read check
(`decide` step 4) give the same answer. A private item the caller may not see is
absent from the list and reads exactly like an unknown id.
"""

import os
from uuid import uuid4

import pytest


def _new_session(caller, *, visibility, name):
    session_id = f"m3-parity-{uuid4().hex[:16]}"
    response = caller(
        "PUT",
        "/sessions/streams/header",
        params={"session_id": session_id, "visibility": visibility},
        json={"name": name},
    )
    assert response.status_code == 200, response.text
    return session_id


def _new_agent(caller, *, visibility, name):
    response = caller(
        "POST",
        "/workflows/",
        json={
            "workflow": {
                "slug": f"m3-parity-{uuid4().hex[:12]}",
                "name": name,
                "flags": {"is_agent": True},
                "visibility": visibility,
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["workflow"]["id"]


def _listed_sessions(caller):
    response = caller("POST", "/sessions/query", json={})
    assert response.status_code == 200, response.text
    body = response.json()
    sessions = body.get("sessions") or []
    return {session["session_id"] for session in sessions}


def _readable_session(caller, session_id):
    response = caller("GET", "/sessions/streams/", params={"session_id": session_id})
    assert response.status_code == 200, response.text
    return response.json().get("stream") is not None


def _listed_agents(caller):
    response = caller("POST", "/workflows/query", json={})
    assert response.status_code == 200, response.text
    return {workflow["id"] for workflow in response.json().get("workflows") or []}


def _readable_agent(caller, artifact_id):
    response = caller("GET", f"/workflows/{artifact_id}")
    assert response.status_code == 200, response.text
    return response.json().get("count") == 1


def _unknown_session_answer(caller):
    response = caller(
        "GET", "/sessions/streams/", params={"session_id": f"m3-none-{uuid4().hex}"}
    )
    return response.status_code, response.json()


@pytest.fixture
def items(sharing_team):
    alice = sharing_team["alice"]
    bob = sharing_team["bob"]
    return {
        "alice_private_session": _new_session(
            alice, visibility="private", name="alice private"
        ),
        "alice_project_session": _new_session(
            alice, visibility="project", name="alice project"
        ),
        "bob_private_session": _new_session(
            bob, visibility="private", name="bob private"
        ),
        "alice_private_agent": _new_agent(
            alice, visibility="private", name="alice private agent"
        ),
        "alice_project_agent": _new_agent(
            alice, visibility="project", name="alice project agent"
        ),
    }


def _assert_parity(caller, items, *, expect_sessions, expect_agents):
    sessions = {key: value for key, value in items.items() if key.endswith("_session")}
    agents = {key: value for key, value in items.items() if key.endswith("_agent")}

    listed = _listed_sessions(caller)
    readable = {
        key
        for key, session_id in sessions.items()
        if _readable_session(caller, session_id)
    }
    shown = {key for key, session_id in sessions.items() if session_id in listed}
    assert shown == readable == set(expect_sessions)
    # Every listed session can be read directly.
    for session_id in listed:
        assert _readable_session(caller, session_id), session_id

    listed_agents = _listed_agents(caller)
    readable_agents = {
        key
        for key, artifact_id in agents.items()
        if _readable_agent(caller, artifact_id)
    }
    shown_agents = {
        key for key, artifact_id in agents.items() if artifact_id in listed_agents
    }
    assert shown_agents == readable_agents == set(expect_agents)
    for artifact_id in listed_agents:
        assert _readable_agent(caller, artifact_id), artifact_id


def test_parity_human(sharing_team, items):
    bob = sharing_team["bob"]
    _assert_parity(
        bob,
        items,
        expect_sessions={"alice_project_session", "bob_private_session"},
        expect_agents={"alice_project_agent"},
    )
    # Alice's private session reads exactly like an unknown id.
    hidden = bob(
        "GET",
        "/sessions/streams/",
        params={"session_id": items["alice_private_session"]},
    )
    assert (hidden.status_code, hidden.json()) == _unknown_session_answer(bob)

    _assert_parity(
        sharing_team["alice"],
        items,
        expect_sessions={"alice_private_session", "alice_project_session"},
        expect_agents={"alice_private_agent", "alice_project_agent"},
    )


def test_parity_api_key_excludes_creator_private(sharing_team, items):
    # An API key is not a person: it sees no private item, not even its creator's.
    _assert_parity(
        sharing_team["alice_key"],
        items,
        expect_sessions={"alice_project_session"},
        expect_agents={"alice_project_agent"},
    )


def test_parity_installation(sharing_team, items):
    """A channel installation sees project items only. The installation credential
    comes from a connected channel (`AGENTA_TEST_INSTALLATION_CREDENTIALS`, a run
    credential of an installation of the team's project); without one the test
    cannot run."""

    credentials = os.getenv("AGENTA_TEST_INSTALLATION_CREDENTIALS")
    if not credentials:
        pytest.skip("No channel installation credential for this deployment.")
    installation = sharing_team["alice_key"].__class__(
        api_url=sharing_team["alice_key"].api_url,
        credentials=credentials,
        project_id=sharing_team["project_id"],
        user_id=None,
    )
    _assert_parity(
        installation,
        items,
        expect_sessions={"alice_project_session"},
        expect_agents={"alice_project_agent"},
    )
