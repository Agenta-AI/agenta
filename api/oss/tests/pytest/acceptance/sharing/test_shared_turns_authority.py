"""A shared session runs each turn with the authority of the person who sent it (M3),
against a running API. A viewer reads it and cannot send. Turns are real turns on the
mock harness."""

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    agent_references,
    grant,
    heartbeat,
    invoke,
    new_agent,
    new_session_id,
    poll,
    run_caller,
    turn_rows,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_shared_turns_authority"),
]


def test_bob_turn_after_alice_runs_as_bob(sharing_cast):
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    agent = new_agent(alice, visibility="project")
    session_id = new_session_id()

    first = invoke(alice, session_id=session_id, agent=agent, text="alice asks")
    assert first.status_code == 200, first.text
    grant(alice, session_id, user_id=bob.user_id, role="participant")

    second = invoke(bob, session_id=session_id, agent=agent, text="bob asks")
    assert second.status_code == 200, second.text

    def both_turns():
        rows = turn_rows(sharing_cast.project_id, session_id)
        return rows if len(rows) >= 2 else None

    turns = poll(both_turns)
    assert [
        (row["principal_kind"], row["principal_id"], row["sender_user_id"])
        for row in turns
    ] == [
        ("human", alice.user_id, alice.user_id),
        ("human", bob.user_id, bob.user_id),
    ]
    assert [row["origin"] for row in turns] == ["web", "web"]


def test_viewer_send_is_refused(sharing_cast):
    """A viewer reads the session and cannot send to it: 403 `access_denied`, not
    the not-found answer (the session is readable to them)."""

    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    agent = new_agent(alice, visibility="project")
    session_id = new_session_id()
    first = invoke(alice, session_id=session_id, agent=agent, text="alice asks")
    assert first.status_code == 200, first.text
    grant(alice, session_id, user_id=bob.user_id, role="viewer")

    send = bob(
        "POST",
        "/sessions/streams/",
        json={
            "session_id": session_id,
            "data": {"inputs": {"messages": [{"role": "user", "content": "hi"}]}},
        },
    )
    assert send.status_code == 403, send.text
    assert send.json()["detail"]["code"] == "access_denied"
    assert send.json()["detail"]["details"]["reason"] == "resource_denied"

    # The runner's first beat of a turn Bob would start is refused the same way.
    beat = heartbeat(
        run_caller(sharing_cast, "bob"),
        session_id=session_id,
        turn_id=new_session_id(),
        references=agent_references(agent),
    )
    assert beat.status_code == 403, beat.text
    assert beat.json()["detail"]["code"] == "access_denied"
    assert [
        row["principal_id"] for row in turn_rows(sharing_cast.project_id, session_id)
    ] == [alice.user_id]
