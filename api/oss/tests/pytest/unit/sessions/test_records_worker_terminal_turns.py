"""`terminal_turns_in_batch` names every settled turn, not one per session.

The channels outbox renders a turn only on its turn-ended signal. A batch that
commits the terminal records of two turns of one session (a parked turn and
the continuation that answered it) must publish both, or the overwritten turn's
card or answer never draws.
"""

from types import SimpleNamespace

from oss.src.tasks.asyncio.sessions.records_worker import (
    TERMINAL_RECORD_TYPE,
    terminal_turns_in_batch,
)

SESSION = "11111111-1111-4111-8111-111111111111"
PARKED_TURN = "22222222-2222-4222-8222-222222222222"
RESUME_TURN = "33333333-3333-4333-8333-333333333333"


def _record(turn_id, *, record_type=TERMINAL_RECORD_TYPE, session_id=SESSION):
    return SimpleNamespace(
        record_type=record_type, turn_id=turn_id, session_id=session_id
    )


def test_two_terminal_turns_of_one_session_are_both_kept():
    pairs = terminal_turns_in_batch([_record(PARKED_TURN), _record(RESUME_TURN)])

    assert pairs == [(SESSION, PARKED_TURN), (SESSION, RESUME_TURN)]


def test_a_repeated_terminal_record_counts_once():
    pairs = terminal_turns_in_batch([_record(PARKED_TURN), _record(PARKED_TURN)])

    assert pairs == [(SESSION, PARKED_TURN)]


def test_non_terminal_records_and_missing_turn_ids_are_skipped():
    pairs = terminal_turns_in_batch(
        [
            _record(PARKED_TURN, record_type="message"),
            _record(None),
            _record(RESUME_TURN),
        ]
    )

    assert pairs == [(SESSION, RESUME_TURN)]
