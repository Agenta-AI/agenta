"""The chat's one-session stream read carries the reader's sharing state (M3 gate, latency
finding 4), against a running API: the owner's read lists the grants (the Share button
counts them), a grantee's does not, and an agent made private to someone else reads
`agent_hidden` on the next read."""

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    agent_references,
    grant,
    heartbeat,
    new_agent,
    new_session_id,
    run_caller,
    set_agent_visibility,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_stream_sharing_state"),
]


def _stream_sharing(caller, session_id):
    response = caller(
        "POST", "/sessions/streams/query", json={"session_id": session_id}
    )
    assert response.status_code == 200, response.text
    streams = response.json()["streams"]
    return streams[0].get("sharing") if streams else None


def test_the_stream_read_carries_grants_for_the_owner_and_agent_visibility(
    sharing_cast,
):
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    agent = new_agent(alice, visibility="project")
    session_id = new_session_id()
    beat = heartbeat(
        run_caller(sharing_cast, "alice"),
        session_id=session_id,
        turn_id=new_session_id(),
        references=agent_references(agent),
    )
    assert beat.status_code == 200, beat.text
    grant(alice, session_id, user_id=bob.user_id, role="participant")

    owner = _stream_sharing(alice, session_id)
    assert owner["my_role"] == "owner"
    assert [g["user_id"] for g in owner["grants"]] == [bob.user_id]
    assert owner["agent_hidden"] is False

    grantee = _stream_sharing(bob, session_id)
    assert grantee["my_role"] == "participant"
    assert grantee["grants"] == []
    assert grantee["agent_hidden"] is False

    assert set_agent_visibility(alice, agent["id"], "private").status_code == 200
    assert _stream_sharing(bob, session_id)["agent_hidden"] is True
    assert _stream_sharing(alice, session_id)["agent_hidden"] is False
