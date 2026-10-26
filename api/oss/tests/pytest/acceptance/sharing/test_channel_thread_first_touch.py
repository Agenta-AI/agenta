"""A channel thread whose session row does not exist yet (the channel inbox writes the
thread first), against a running API.

Whoever creates the row, it gets the channel policy: project-visible and ownerless.
A person's first send, from a browser (Bearer) or with a web run credential
(`Secret`), is checked against that row before any lock and refused, so it reserves no
turn. A person's first heartbeat is refused too, and the row stays for the channel.
"""

from uuid import uuid4

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    core_rows,
    heartbeat,
    new_session_id,
    read_stream,
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


def _assert_channel_row_not_running(cast, caller, session_id):
    row = stream_row(cast.project_id, session_id)
    assert row is not None
    assert (row["visibility"], row["owner_user_id"]) == ("project", None)
    stream = read_stream(caller, session_id)
    assert stream.status_code == 200, stream.text
    flags = stream.json()["stream"]["flags"]
    assert (flags["is_alive"], flags["is_running"]) == (False, False)


@pytest.mark.parametrize("credential", ["bearer", "secret"])
def test_a_person_s_first_send_reserves_no_turn(sharing_cast, credential):
    alice = sharing_cast["alice"]
    caller = alice if credential == "bearer" else run_caller(sharing_cast, "alice")
    session_id = _channel_thread(sharing_cast)

    send = _send(caller, session_id)
    assert send.status_code == 403, send.text
    _assert_channel_row_not_running(sharing_cast, alice, session_id)


def test_a_person_s_first_heartbeat_is_refused_and_the_row_stays(sharing_cast):
    alice = sharing_cast["alice"]
    session_id = _channel_thread(sharing_cast)

    beat = heartbeat(
        run_caller(sharing_cast, "alice"),
        session_id=session_id,
        turn_id=str(uuid4()),
    )
    assert beat.status_code == 403, beat.text
    _assert_channel_row_not_running(sharing_cast, alice, session_id)
