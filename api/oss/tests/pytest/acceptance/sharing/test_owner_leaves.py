"""When the owner leaves the project (M3, Review Focus 3), against a running API.

A private item needs an active owner: when Alice is removed, her private session and
her private agent are locked for everyone (they read like unknown ids), and the grants
she gave are inert. Every member can still read her project-visible session and send
to it; her project-visible agent still runs, and an admin can take it over. When Alice is
added back, access returns without anyone sharing again.

Each test removes Alice and adds her back at the end.
"""

from contextlib import contextmanager

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    NOT_FOUND_BODY,
    create_header,
    fetch_sharing,
    grant,
    invoke,
    listed_agents,
    listed_sessions,
    new_agent,
    new_session_id,
    poll,
    read_stream,
    readd_member,
    remove_member,
    same_answer,
    stream_is_readable,
    stream_row,
    turn_rows,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_owner_leaves"),
]


@contextmanager
def _alice_removed(cast):
    remove_member(cast, "alice")
    try:
        yield
    finally:
        readd_member(cast, "alice")


def _send(caller, session_id):
    return caller(
        "POST",
        "/sessions/streams/",
        json={
            "session_id": session_id,
            "data": {"inputs": {"messages": [{"role": "user", "content": "hi"}]}},
        },
    )


def _assert_locked(caller, *, session_id, agent_id):
    unknown_id = new_session_id()
    assert same_answer(
        read_stream(caller, session_id),
        read_stream(caller, unknown_id),
        hidden_id=session_id,
        unknown_id=unknown_id,
    )
    assert session_id not in listed_sessions(caller)
    assert fetch_sharing(caller, session_id).json() == NOT_FOUND_BODY
    send = _send(caller, session_id)
    assert (send.status_code, send.json()) == (404, NOT_FOUND_BODY)

    assert caller("GET", f"/workflows/{agent_id}").json().get("count") == 0
    assert agent_id not in listed_agents(caller)
    agent_sharing = caller("GET", f"/workflows/{agent_id}/sharing")
    assert (agent_sharing.status_code, agent_sharing.json()) == (404, NOT_FOUND_BODY)


def test_private_items_locked(sharing_cast):
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    project_agent = new_agent(alice, visibility="project")
    private_agent = new_agent(alice, visibility="private")
    session_id = new_session_id()
    turn = invoke(alice, session_id=session_id, agent=project_agent)
    assert turn.status_code == 200, turn.text
    grant(alice, session_id, user_id=bob.user_id, role="participant")
    assert stream_is_readable(bob, session_id)

    with _alice_removed(sharing_cast):
        for label in ("bob", "dana", "owner"):
            _assert_locked(
                sharing_cast[label],
                session_id=session_id,
                agent_id=private_agent["id"],
            )


def test_project_session_stays_open_to_members(sharing_cast):
    alice, bob, dana = (sharing_cast[label] for label in ("alice", "bob", "dana"))
    agent = new_agent(alice, visibility="project")
    session_id = new_session_id()
    created = create_header(alice, session_id, visibility="project")
    assert created.status_code == 200, created.text
    turn = invoke(alice, session_id=session_id, agent=agent)
    assert turn.status_code == 200, turn.text

    with _alice_removed(sharing_cast):
        # Readable by every member, and a member sends under their own authority.
        assert stream_is_readable(bob, session_id)
        assert session_id in listed_sessions(bob)
        send = invoke(bob, session_id=session_id, agent=agent, text="bob asks")
        assert send.status_code == 200, send.text

        def both_turns():
            rows = turn_rows(sharing_cast.project_id, session_id)
            return rows if len(rows) >= 2 else None

        turns = poll(both_turns)
        assert [row["principal_id"] for row in turns] == [alice.user_id, bob.user_id]

        # Delete is an edit, and an edit stays with the owner: Bob's delete is
        # refused and the session stays.
        delete = bob("DELETE", "/sessions/streams/", params={"session_id": session_id})
        assert delete.status_code == 403, delete.text
        assert stream_row(sharing_cast.project_id, session_id)["deleted_at"] is None

        # The project agent still runs, in a session of Bob's.
        own_session = new_session_id()
        own_turn = invoke(bob, session_id=own_session, agent=agent)
        assert own_turn.status_code == 200, own_turn.text
        turns = poll(lambda: turn_rows(sharing_cast.project_id, own_session))
        assert [row["principal_id"] for row in turns] == [bob.user_id]

        # An admin takes over the agent of the member who left.
        taken = dana("POST", f"/workflows/{agent['id']}/sharing/take-ownership")
        assert taken.status_code == 200, taken.text
        assert taken.json()["sharing"]["policy"]["owner_user_id"] == dana.user_id


def test_access_returns_on_rejoin(sharing_cast):
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    agent = new_agent(alice, visibility="private")
    session_id = new_session_id()
    created = create_header(alice, session_id)
    assert created.status_code == 200, created.text
    turn = invoke(alice, session_id=session_id, agent=agent)
    assert turn.status_code == 200, turn.text
    grant(alice, session_id, user_id=bob.user_id, role="viewer")

    with _alice_removed(sharing_cast):
        assert not stream_is_readable(bob, session_id)

    # Back in the project: the owner and the grant work again, nobody shared again.
    assert stream_is_readable(alice, session_id)
    assert alice("GET", f"/workflows/{agent['id']}").json().get("count") == 1
    assert stream_is_readable(bob, session_id)
    assert session_id in listed_sessions(bob)
    sharing = fetch_sharing(bob, session_id)
    assert sharing.status_code == 200, sharing.text
    assert sharing.json()["sharing"]["my_role"] == "viewer"
