"""Heartbeat admission (M3, deviation 6), against a running API.

Every heartbeat is authorized before any lock, write or answer, except a running beat
of a turn whose admission this principal already holds (verified continuity). A beat
that creates the session gets the owner rule's policy; a refused beat that hides the
session answers the one canonical not-found body and writes nothing.

Beats are sent with run credentials, as the runner sends them: a person's web run
credential (`run_caller`) or the credential the exchange mints for an API key.
"""

import secrets
from uuid import uuid4

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    NOT_FOUND_BODY,
    Caller,
    core_rows,
    agent_references,
    create_person,
    delete_person,
    exchanged_run_caller,
    first_id,
    grant,
    heartbeat,
    new_agent,
    new_session_id,
    project_key,
    revoke,
    run_caller,
    stream_row,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_heartbeat_admission"),
]


def _not_found(response):
    return (response.status_code, response.json()) == (404, NOT_FOUND_BODY)


def _row_turn_id(cast, session_id):
    rows = core_rows(
        "SELECT turn_id FROM session_streams WHERE project_id = $1::uuid"
        " AND session_id = $2",
        str(cast.project_id),
        session_id,
    )
    return rows[0]["turn_id"] if rows else None


def _alice_private_session(cast, agent):
    """A private session of Alice's, created by the first beat of her turn."""

    alice_run = run_caller(cast, "alice")
    session_id, turn_id = new_session_id(), new_session_id()
    beat = heartbeat(
        alice_run,
        session_id=session_id,
        turn_id=turn_id,
        references=agent_references(agent),
    )
    assert beat.status_code == 200, beat.text
    return session_id, turn_id


@pytest.fixture(scope="module")
def agents(sharing_cast):
    alice = sharing_cast["alice"]
    return {
        "project": new_agent(alice, visibility="project"),
        "private": new_agent(alice, visibility="private"),
    }


def test_browser_human_new_session_owned(sharing_cast, agents):
    alice = sharing_cast["alice"]
    session_id, _ = _alice_private_session(sharing_cast, agents["project"])

    row = stream_row(sharing_cast.project_id, session_id)
    assert (row["visibility"], row["owner_user_id"]) == ("private", alice.user_id)


def test_api_key_new_session_ownerless(sharing_cast, agents):
    key_run = exchanged_run_caller(sharing_cast.alice_key)
    session_id = new_session_id()

    beat = heartbeat(
        key_run,
        session_id=session_id,
        turn_id=new_session_id(),
        references=agent_references(agents["project"]),
    )
    assert beat.status_code == 200, beat.text

    row = stream_row(sharing_cast.project_id, session_id)
    assert (row["visibility"], row["owner_user_id"]) == ("project", None)


def test_first_beat_into_foreign_private_session_refused(sharing_cast, agents):
    session_id, alice_turn = _alice_private_session(sharing_cast, agents["project"])
    bob_run = run_caller(sharing_cast, "bob")

    beat = heartbeat(
        bob_run,
        session_id=session_id,
        turn_id=new_session_id(),
        references=agent_references(agents["project"]),
    )

    assert _not_found(beat), beat.text
    # Nothing written: the row still carries Alice's turn.
    assert _row_turn_id(sharing_cast, session_id) == alice_turn


def test_first_beat_with_private_agent_refused(sharing_cast, agents):
    bob_run = run_caller(sharing_cast, "bob")
    session_id = new_session_id()

    beat = heartbeat(
        bob_run,
        session_id=session_id,
        turn_id=new_session_id(),
        references=agent_references(agents["private"]),
    )

    assert _not_found(beat), beat.text
    assert stream_row(sharing_cast.project_id, session_id) is None


def test_turn_target_checked_not_stored_references(sharing_cast, agents):
    """Bob's session names a project agent; his next turn runs Alice's private
    agent, and that turn's first beat is refused."""

    bob_run = run_caller(sharing_cast, "bob")
    session_id, first_turn = new_session_id(), new_session_id()
    for running in (True, False):
        beat = heartbeat(
            bob_run,
            session_id=session_id,
            turn_id=first_turn,
            is_running=running,
            references=agent_references(agents["project"]),
        )
        assert beat.status_code == 200, beat.text

    beat = heartbeat(
        bob_run,
        session_id=session_id,
        turn_id=new_session_id(),
        references=agent_references(agents["private"]),
    )
    assert _not_found(beat), beat.text
    assert _row_turn_id(sharing_cast, session_id) == first_turn


def test_unresolved_reference_refused(sharing_cast):
    bob_run = run_caller(sharing_cast, "bob")
    session_id = new_session_id()

    beat = heartbeat(
        bob_run,
        session_id=session_id,
        turn_id=new_session_id(),
        references=[{"key": "workflow", "id": str(uuid4())}],
    )

    assert _not_found(beat), beat.text
    assert stream_row(sharing_cast.project_id, session_id) is None


def test_draft_turn_checks_session_only(sharing_cast, agents):
    """A draft run names no agent: its beat checks the session alone."""

    bob_run = run_caller(sharing_cast, "bob")
    own = new_session_id()
    beat = heartbeat(bob_run, session_id=own, turn_id=new_session_id())
    assert beat.status_code == 200, beat.text

    foreign, _ = _alice_private_session(sharing_cast, agents["project"])
    beat = heartbeat(bob_run, session_id=foreign, turn_id=new_session_id())
    assert _not_found(beat), beat.text


def test_later_beats_run_no_admission(sharing_cast, agents):
    """Beats 2 to 5 of Bob's admitted turn are not checked again: they go on after
    Alice revokes his grant. The turn's end beat is checked, and refused."""

    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    session_id, alice_turn = _alice_private_session(sharing_cast, agents["project"])
    end = heartbeat(
        run_caller(sharing_cast, "alice"),
        session_id=session_id,
        turn_id=alice_turn,
        is_running=False,
    )
    assert end.status_code == 200, end.text
    grant(alice, session_id, user_id=bob.user_id, role="participant")

    bob_run, bob_turn = run_caller(sharing_cast, "bob"), new_session_id()
    references = agent_references(agents["project"])
    first = heartbeat(
        bob_run, session_id=session_id, turn_id=bob_turn, references=references
    )
    assert first.status_code == 200, first.text
    assert first.json()["is_current_turn"] is True

    revoke(alice, session_id, user_id=bob.user_id)
    for _ in range(4):
        beat = heartbeat(
            bob_run, session_id=session_id, turn_id=bob_turn, references=references
        )
        assert beat.status_code == 200, beat.text
        assert beat.json()["is_current_turn"] is True

    end = heartbeat(bob_run, session_id=session_id, turn_id=bob_turn, is_running=False)
    assert _not_found(end), end.text


def test_beat_without_turn_or_not_running_is_checked(sharing_cast, agents):
    session_id, alice_turn = _alice_private_session(sharing_cast, agents["project"])
    bob_run = run_caller(sharing_cast, "bob")

    no_turn = heartbeat(bob_run, session_id=session_id)
    assert _not_found(no_turn), no_turn.text
    not_running = heartbeat(
        bob_run, session_id=session_id, turn_id=alice_turn, is_running=False
    )
    assert _not_found(not_running), not_running.text
    assert _row_turn_id(sharing_cast, session_id) == alice_turn


def test_foreign_credential_with_admitted_turn_id_is_refused(sharing_cast, agents):
    """Alice's turn is admitted; Bob's credential naming the same turn id is not."""

    session_id, alice_turn = _alice_private_session(sharing_cast, agents["project"])

    beat = heartbeat(
        run_caller(sharing_cast, "bob"),
        session_id=session_id,
        turn_id=alice_turn,
        references=agent_references(agents["project"]),
    )

    assert _not_found(beat), beat.text


def test_superseded_and_other_replica_branches_are_checked_first(sharing_cast, agents):
    """The answers that say "not your turn" (another replica, a superseded turn)
    come after the check: Bob gets the not-found answer, not those."""

    alice_run = run_caller(sharing_cast, "alice")
    session_id, first_turn = _alice_private_session(sharing_cast, agents["project"])
    # Alice's next turn supersedes the first.
    heartbeat(alice_run, session_id=session_id, turn_id=first_turn, is_running=False)
    second = heartbeat(
        alice_run,
        session_id=session_id,
        turn_id=new_session_id(),
        references=agent_references(agents["project"]),
    )
    assert second.status_code == 200, second.text

    bob_run = run_caller(sharing_cast, "bob")
    other_replica = heartbeat(
        bob_run,
        session_id=session_id,
        turn_id=new_session_id(),
        replica_id="another-replica",
    )
    assert _not_found(other_replica), other_replica.text
    superseded = heartbeat(bob_run, session_id=session_id, turn_id=first_turn)
    assert _not_found(superseded), superseded.text

    # For Alice the same superseded beat is a normal "not the current turn" answer.
    own = heartbeat(alice_run, session_id=session_id, turn_id=first_turn)
    assert own.status_code == 200, own.text
    assert own.json()["is_current_turn"] is False


def test_hiding_refusals_have_one_body(sharing_cast, agents, admin_api, ag_env):
    """A private session, a private agent, an unknown, an archived and a foreign
    project's agent reference: one answer, the canonical not-found body."""

    alice = sharing_cast["alice"]
    archived = new_agent(alice, visibility="project")
    response = alice("POST", f"/workflows/{archived['id']}/archive")
    assert response.status_code == 200, response.text

    email = f"m3-foreign-{uuid4().hex[:10]}@test.agenta.ai"
    foreign_account = create_person(
        admin_api, email=email, password=secrets.token_urlsafe(18)
    )
    try:
        foreign_project = first_id(foreign_account["projects"])
        foreign = new_agent(
            Caller(
                api_url=ag_env["api_url"],
                credentials=project_key(
                    admin_api,
                    project_id=foreign_project,
                    user_id=foreign_account["user"]["id"],
                ),
                project_id=foreign_project,
                user_id=foreign_account["user"]["id"],
            ),
            visibility="project",
        )

        bob_run = run_caller(sharing_cast, "bob")
        private_session, _ = _alice_private_session(sharing_cast, agents["project"])
        refusals = {
            "private session": heartbeat(
                bob_run,
                session_id=private_session,
                turn_id=new_session_id(),
                references=agent_references(agents["project"]),
            ),
        }
        for name, references in (
            ("private agent", agent_references(agents["private"])),
            ("unknown reference", [{"key": "workflow", "id": str(uuid4())}]),
            ("archived agent", agent_references(archived)),
            ("foreign project agent", agent_references(foreign)),
        ):
            refusals[name] = heartbeat(
                bob_run,
                session_id=new_session_id(),
                turn_id=new_session_id(),
                references=references,
            )
    finally:
        delete_person(admin_api, email=email)

    answers = {name: (r.status_code, r.text) for name, r in refusals.items()}
    assert set(answers.values()) == {(404, refusals["private session"].text)}, answers
    assert refusals["private session"].json() == NOT_FOUND_BODY


def test_concurrent_create_authorizes_the_winning_row(sharing_cast, agents):
    """Bob's beat expects to create a session; Alice's header call created it
    first. The beat is checked against the winning row (Alice's, private) and
    refused. The race itself (two first touches at once) is pinned by
    `test_concurrent_create_authorizes_the_winning_row` in
    unit/sessions/test_heartbeat_admission.py."""

    alice = sharing_cast["alice"]
    session_id = new_session_id()
    created = alice(
        "PUT",
        "/sessions/streams/header",
        params={"session_id": session_id},
        json={"name": "alice first"},
    )
    assert created.status_code == 200, created.text

    beat = heartbeat(
        run_caller(sharing_cast, "bob"),
        session_id=session_id,
        turn_id=new_session_id(),
        references=agent_references(agents["project"]),
    )

    assert _not_found(beat), beat.text
    row = stream_row(sharing_cast.project_id, session_id)
    assert (row["visibility"], row["owner_user_id"]) == ("private", alice.user_id)


def test_stopped_beat_of_admitted_principal_is_checked(sharing_cast, agents):
    """Bob's turn was admitted, then his grant revoked. His end beat is checked and
    refused, and it ends his continuity: a replayed running beat of that turn is
    checked again, and refused."""

    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    session_id, alice_turn = _alice_private_session(sharing_cast, agents["project"])
    alice_run = run_caller(sharing_cast, "alice")
    heartbeat(alice_run, session_id=session_id, turn_id=alice_turn, is_running=False)
    grant(alice, session_id, user_id=bob.user_id, role="participant")

    bob_run, bob_turn = run_caller(sharing_cast, "bob"), new_session_id()
    references = agent_references(agents["project"])
    first = heartbeat(
        bob_run, session_id=session_id, turn_id=bob_turn, references=references
    )
    assert first.status_code == 200, first.text
    revoke(alice, session_id, user_id=bob.user_id)

    stopped = heartbeat(
        bob_run, session_id=session_id, turn_id=bob_turn, is_running=False
    )
    assert _not_found(stopped), stopped.text
    replay = heartbeat(
        bob_run, session_id=session_id, turn_id=bob_turn, references=references
    )
    assert _not_found(replay), replay.text


def test_admission_record_error_fails_closed():
    pytest.skip(
        "Needs a Redis fault on the API's admission record read, which the "
        "acceptance layer cannot inject into a running stack. Pinned by "
        "test_admission_record_error_fails_closed in "
        "unit/sessions/test_heartbeat_admission.py and unit/sharing/test_route_checks.py."
    )
