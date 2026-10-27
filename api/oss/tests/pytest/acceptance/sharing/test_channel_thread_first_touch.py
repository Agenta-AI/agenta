"""A channel thread whose session row does not exist yet (the channel inbox writes the
thread first), against a running API.

Only the channel's own run creates that row, with the channel policy it computed
(private to the agent's owner for a private agent, else project-visible and ownerless).
A person's first send, from a browser (Bearer) or with a web run credential (`Secret`),
and a person's first heartbeat, create nothing: the id is reserved and answers like an
unknown session (404), so no turn is reserved and no row is left.
"""

from uuid import uuid4

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    core_rows,
    heartbeat,
    new_session_id,
    run_caller,
    stream_row,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_channel_thread_first_touch"),
]


def _channel_thread(cast) -> str:
    session_id = new_session_id()
    core_rows(
        "INSERT INTO channel_threads (id, project_id, space_id, agent_id, session_id) "
        "VALUES ($1, $2::uuid, $3, $4, $5) RETURNING id",
        uuid4(),
        cast.project_id,
        uuid4(),
        uuid4(),
        session_id,
    )
    return session_id


def _send(caller, session_id):
    return caller(
        "POST",
        "/sessions/streams/",
        json={
            "session_id": session_id,
            "data": {"inputs": {"messages": [{"role": "user", "content": "hi"}]}},
        },
    )


def _assert_no_row(cast, session_id):
    assert stream_row(cast.project_id, session_id) is None


@pytest.mark.parametrize("credential", ["bearer", "secret"])
def test_a_person_s_first_send_reserves_no_turn(sharing_cast, credential):
    alice = sharing_cast["alice"]
    caller = alice if credential == "bearer" else run_caller(sharing_cast, "alice")
    session_id = _channel_thread(sharing_cast)
    send = _send(caller, session_id)
    assert send.status_code == 404, send.text
    _assert_no_row(sharing_cast, session_id)


def test_a_person_s_first_heartbeat_creates_nothing(sharing_cast):
    session_id = _channel_thread(sharing_cast)
    beat = heartbeat(
        run_caller(sharing_cast, "alice"),
        session_id=session_id,
        turn_id=str(uuid4()),
    )
    assert beat.status_code == 404, beat.text
    _assert_no_row(sharing_cast, session_id)
