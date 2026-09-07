"""A runner's claim must take the commands it understands past a row it cannot map.

`claim_commands` returned `[map_command_dbe_to_dto(dbe) for dbe in claimed]`, the same batch
map that poisoned the abandoned-command sweep: a newer API replica can write a command `kind`
this older replica's enum does not know, and `map_command_dbe_to_dto` raises `ValueError` on
that row. One such row in a claimed batch would have thrown away the whole claim, including a
Stop the runner could act on. The claim path now maps through
`_map_commands_skipping_unmappable`, which skips the rows this API cannot map, warns once per
batch, and returns the rest.
"""

from datetime import datetime, timezone
from uuid import uuid4

from types import SimpleNamespace

from oss.src.core.sessions.commands.dtos import (
    SessionCommandKind,
    SessionCommandState,
)
from oss.src.dbs.postgres.sessions.commands import dao as commands_dao


def _row(kind: str):
    """A claimed command row as the DAO reads it, with a given `kind` string."""
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


def test_a_claimable_stop_survives_an_unknown_kind_in_the_batch(monkeypatch):
    recorder = _RecordingLog()
    monkeypatch.setattr(commands_dao, "log", recorder)

    stop = _row(SessionCommandKind.cancel.value)
    unknown = _row("continue_interaction")

    mapped = commands_dao._map_commands_skipping_unmappable(
        [stop, unknown], context="claimed"
    )

    # The Stop is handed to the runner; the unknown row is left for a replica that knows it.
    assert [c.id for c in mapped] == [stop.id]
    assert unknown.id not in {c.id for c in mapped}


def test_the_claim_warning_names_the_claimed_context_and_the_kind(monkeypatch):
    recorder = _RecordingLog()
    monkeypatch.setattr(commands_dao, "log", recorder)

    commands_dao._map_commands_skipping_unmappable(
        [_row(SessionCommandKind.cancel.value), _row("continue_interaction")],
        context="claimed",
    )

    assert len(recorder.warnings) == 1
    args = recorder.warnings[0][0]
    assert args[1] == 1  # one unmappable row
    assert args[2] == "claimed"  # the batch context
    assert "continue_interaction=1" in args[3]
