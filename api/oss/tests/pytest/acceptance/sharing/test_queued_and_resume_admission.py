"""Run admission where stored work starts again (M3), against a running API.

A queued input and an approval resume run later than the request that created them,
so the sharing state is checked again when they start. Turns are real turns on the
mock harness (`slow` to keep a turn busy, `approval` to park on a gate).
"""

import threading
from uuid import uuid4

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    core_rows,
    grant,
    invoke,
    new_agent,
    new_session_id,
    poll,
    read_stream,
    revoke,
    set_agent_visibility,
    turn_rows,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_queued_and_resume_admission"),
]


def _pending_interaction(caller, session_id):
    response = caller(
        "POST",
        "/sessions/interactions/query",
        json={"interaction": {"session_id": session_id}},
    )
    assert response.status_code == 200, response.text
    pending = [
        item
        for item in response.json().get("interactions") or []
        if item["status"] == "pending"
    ]
    assert len(pending) == 1, response.text
    return pending[0]


def _respond(caller, interaction_id, *, approved=True):
    return caller(
        "POST",
        f"/sessions/interactions/{interaction_id}/respond",
        headers={"Idempotency-Key": str(uuid4())},
        json={"answer": {"approved": approved}},
    )


def _running_turn(caller, session_id):
    """The id of the session's running turn, or None."""

    response = read_stream(caller, session_id)
    assert response.status_code == 200, response.text
    stream = response.json().get("stream") or {}
    if (stream.get("flags") or {}).get("is_running") is not True:
        return None
    return stream.get("turn_id")


def _commands(project_id, session_id):
    return core_rows(
        "SELECT kind, state, outcome FROM session_commands"
        " WHERE project_id = $1::uuid AND session_id = $2",
        str(project_id),
        session_id,
    )


def test_queued_input_stops_after_grant_revoked(sharing_cast):
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    agent = new_agent(
        alice, visibility="project", behavior="slow", ms=5000, then="reply", text="ok"
    )
    session_id = new_session_id()
    first = invoke(alice, session_id=session_id, agent=agent, text="first")
    assert first.status_code == 200, first.text
    grant(alice, session_id, user_id=bob.user_id, role="participant")

    # Alice's second turn keeps the session busy while Bob queues an input.
    first_turn = read_stream(alice, session_id).json()["stream"]["turn_id"]
    busy = {}
    worker = threading.Thread(
        target=lambda: busy.setdefault(
            "response", invoke(alice, session_id=session_id, agent=agent, text="busy")
        )
    )
    worker.start()
    assert poll(
        lambda: _running_turn(alice, session_id) not in (None, first_turn),
        timeout=15,
    ), "Alice's second turn did not start"
    queued = invoke(
        bob,
        session_id=session_id,
        agent=agent,
        text="bob queued",
        idempotency_key=str(uuid4()),
        on_busy="queue",
    )
    assert queued.status_code == 202, queued.text
    assert queued.json()["action"] == "pending", queued.text

    revoke(alice, session_id, user_id=bob.user_id)
    worker.join()
    assert busy["response"].status_code == 200, busy["response"].text

    # The queued input settles failed and nothing runs for Bob.
    settled = poll(
        lambda: [
            command
            for command in _commands(sharing_cast.project_id, session_id)
            if command["kind"] == "continue_input" and command["outcome"]
        ]
    )
    assert [(c["state"], c["outcome"]) for c in settled] == [("obsolete", "failed")]
    principals = [
        row["principal_id"] for row in turn_rows(sharing_cast.project_id, session_id)
    ]
    assert principals == [alice.user_id, alice.user_id]


def test_resume_stops_when_alice_lost_agent(sharing_cast):
    """Dana's agent was project-visible when Alice's turn parked on an approval. Dana
    makes it private; Alice's approval does not resume the run."""

    alice, dana = sharing_cast["alice"], sharing_cast["dana"]
    agent = new_agent(dana, visibility="project", behavior="approval", tool="deploy")
    session_id = new_session_id()
    parked = invoke(alice, session_id=session_id, agent=agent, text="deploy it")
    assert parked.status_code == 200, parked.text
    assert '"stopReason": "paused"' in parked.text, parked.text
    interaction = _pending_interaction(alice, session_id)

    response = set_agent_visibility(dana, agent["id"], "private")
    assert response.status_code == 200, response.text

    response = _respond(alice, interaction["id"])
    assert response.status_code == 202, response.text

    # The resume is refused when it would start: its command settles failed.
    settled = poll(
        lambda: [
            command
            for command in _commands(sharing_cast.project_id, session_id)
            if command["kind"] == "continue_interaction" and command["outcome"]
        ]
    )
    assert [(c["state"], c["outcome"]) for c in settled] == [("obsolete", "failed")]

    # Nothing runs as Alice on Dana's private agent: the parked turn is never
    # approved and no new turn starts.
    def approved_turns():
        return [
            row
            for row in turn_rows(sharing_cast.project_id, session_id)
            if row["approved_by_user_id"]
        ]

    assert not approved_turns()
    assert len(turn_rows(sharing_cast.project_id, session_id)) == 1


def test_bob_approves_alice_turn(sharing_cast):
    """Bob (participant) approves the gate of Alice's turn: the run resumes with
    Alice's authority and records Bob as the approver."""

    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    agent = new_agent(alice, visibility="project", behavior="approval", tool="deploy")
    session_id = new_session_id()
    parked = invoke(alice, session_id=session_id, agent=agent, text="deploy it")
    assert parked.status_code == 200, parked.text
    grant(alice, session_id, user_id=bob.user_id, role="participant")
    interaction = _pending_interaction(bob, session_id)

    response = _respond(bob, interaction["id"])
    assert response.status_code == 202, response.text

    approved = poll(
        lambda: [
            row
            for row in turn_rows(sharing_cast.project_id, session_id)
            if row["approved_by_user_id"]
        ]
    )
    assert [
        (row["principal_kind"], row["principal_id"], row["approved_by_user_id"])
        for row in approved
    ] == [("human", alice.user_id, bob.user_id)]
