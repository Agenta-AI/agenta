"""The watchdog must settle the commands it understands past a row it cannot map.

A newer API replica can write a command `kind` (or state, or outcome) an older replica's
enums do not know. On the integration stack a `continue_interaction` row (increment 6, not on
this head) sat in the claimed table next to an abandoned Stop. The abandoned-command sweep
mapped the whole batch to DTOs before it settled any of it, and `map_command_dbe_to_dto`
raised `ValueError: 'continue_interaction' is not a valid SessionCommandKind` on that one row.
The ValueError escaped the batch, so NO command was settled and the Stop stayed pending pass
after pass.

`_map_commands_skipping_unmappable` now skips the rows this API cannot map, warns once with the kinds and
count, and returns the rest. These tests hold that contract: the known Stop survives as a
settle candidate, the unknown row is dropped and left for a replica that knows its kind, and
the skip is logged exactly once.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from oss.src.core.sessions.commands.dtos import (
    SessionCommandKind,
    SessionCommandState,
)
from oss.src.dbs.postgres.sessions.commands import dao as commands_dao


def _row(kind: str):
    """A claimed, abandoned command row as the DAO reads it, with a given `kind` string."""
    return SimpleNamespace(
        id=uuid4(),
        created_at=datetime.now(timezone.utc),
        updated_at=None,
        deleted_at=None,
        created_by_id=None,
        updated_by_id=None,
        deleted_by_id=None,
        project_id=uuid4(),
        session_id="sess-" + kind,
        kind=kind,
        target_turn_id="turn-1",
        expected_turn_id=None,
        data=None,
        state=SessionCommandState.claimed.value,
        claimed_by="runner-1",
        claim_expires_at=datetime.now(timezone.utc),
        claim_count=1,
        outcome=None,
        idempotency_key=None,
        settled_at=None,
        tags=None,
        meta=None,
    )


class _RecordingLog:
    def __init__(self):
        self.warnings = []

    def warning(self, *args, **kwargs):
        self.warnings.append((args, kwargs))


def test_a_known_stop_survives_and_an_unknown_kind_is_left_alone(monkeypatch):
    recorder = _RecordingLog()
    monkeypatch.setattr(commands_dao, "log", recorder)

    stop = _row(SessionCommandKind.cancel.value)
    unknown = _row("continue_interaction")

    mapped = commands_dao._map_commands_skipping_unmappable(
        [stop, unknown], context="abandoned"
    )

    # The Stop is returned, so the sweep will settle it.
    assert [c.id for c in mapped] == [stop.id]
    assert mapped[0].kind is SessionCommandKind.cancel
    # The unknown-kind row is dropped, not settled -- left for a replica that knows its kind.
    assert unknown.id not in {c.id for c in mapped}


def test_the_unknown_kind_is_warned_once_with_its_kind_and_count(monkeypatch):
    recorder = _RecordingLog()
    monkeypatch.setattr(commands_dao, "log", recorder)

    rows = [
        _row(SessionCommandKind.cancel.value),
        _row("continue_interaction"),
        _row("continue_interaction"),
    ]

    commands_dao._map_commands_skipping_unmappable(rows, context="abandoned")

    assert len(recorder.warnings) == 1, "exactly one warning per pass"
    args = recorder.warnings[0][0]
    # The message and its args name the count, the batch context, and the offending kind.
    assert args[1] == 2  # two unmappable rows
    assert args[2] == "abandoned"  # the batch context
    assert "continue_interaction=2" in args[3]


def test_an_all_mappable_batch_logs_nothing(monkeypatch):
    recorder = _RecordingLog()
    monkeypatch.setattr(commands_dao, "log", recorder)

    mapped = commands_dao._map_commands_skipping_unmappable(
        [_row(SessionCommandKind.cancel.value), _row(SessionCommandKind.cancel.value)],
        context="abandoned",
    )

    assert len(mapped) == 2
    assert recorder.warnings == []
