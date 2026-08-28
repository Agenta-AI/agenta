"""Unit tests for the trigger-schedule frequency floor.

Every schedule fire starts an agent run in its own sandbox, so a ``* * * * *``
schedule bills 1440 runs a day and overlaps itself whenever a run outlives a
minute. ``TriggersService._validate_schedule`` therefore refuses any cadence
tighter than ``env.triggers.schedule_min_interval_minutes``.

These pin the gap arithmetic (``_smallest_gap_minutes``), the accept/reject
boundary, the env override, and the message the API hands back. No DB, no HTTP.
"""

import pytest

from oss.src.core.triggers.exceptions import TriggerScheduleInvalid
from oss.src.core.triggers.service import TriggersService
from oss.src.utils.env import env


@pytest.fixture
def floor(monkeypatch):
    """Pin the floor to 15 so these tests do not drift with deployment config."""
    monkeypatch.setattr(env.triggers, "schedule_min_interval_minutes", 15)
    return 15


class TestSmallestGapMinutes:
    @pytest.mark.parametrize(
        "expr, expected",
        [
            ("* * * * *", 1),
            ("*/5 * * * *", 5),
            ("*/15 * * * *", 15),
            ("0 * * * *", 60),
            # A list inside one hour: the tight gap is between :00 and :01, not
            # the 59 minutes that follow it.
            ("0,1 * * * *", 1),
            ("0,30 * * * *", 30),
        ],
    )
    def test_finds_the_tightest_gap(self, expr, expected):
        assert TriggersService._smallest_gap_minutes(expr, stop_below=0) == expected

    def test_day_restricted_expression_is_scanned_from_its_first_fire(self):
        """The expression 0,1 0 31 1 * only ever fires on 31 January, a month
        past the scan base. Anchoring the window on the first fire is what
        catches its one-minute gap; anchoring on the base would see none."""
        assert TriggersService._smallest_gap_minutes("0,1 0 31 1 *", stop_below=0) == 1

    def test_returns_none_when_sparser_than_the_scan_window(self):
        # Monthly and weekly fire at most once inside the two-day window, so
        # there is no gap to measure and nothing that could breach a floor.
        assert TriggersService._smallest_gap_minutes("0 0 1 * *", stop_below=15) is None
        assert TriggersService._smallest_gap_minutes("0 9 * * 1", stop_below=15) is None

    def test_expression_that_never_fires_does_not_raise(self):
        # 30 February. croniter accepts the expression but cannot resolve a date.
        assert (
            TriggersService._smallest_gap_minutes("0 0 30 2 *", stop_below=15) is None
        )

    def test_stops_early_once_below_the_threshold(self):
        # Correctness of the early exit: it must still report the violating gap.
        assert TriggersService._smallest_gap_minutes("* * * * *", stop_below=15) == 1


class TestValidateScheduleFloor:
    @pytest.mark.parametrize(
        "expr",
        [
            "* * * * *",
            "*/5 * * * *",
            "*/14 * * * *",
            "0,1 * * * *",
            "0,5,10 * * * *",
            "0,1 0 31 1 *",
        ],
    )
    def test_rejects_cadences_below_the_floor(self, expr, floor):
        with pytest.raises(TriggerScheduleInvalid):
            TriggersService._validate_schedule(expr)

    @pytest.mark.parametrize(
        "expr",
        [
            "*/15 * * * *",  # exactly at the floor
            "*/30 * * * *",
            "0 * * * *",
            "0 9 * * *",
            "0 9 * * 1",
            "0 0 1 * *",
            "0 0 30 2 *",  # never fires; nothing to police
        ],
    )
    def test_accepts_cadences_at_or_above_the_floor(self, expr, floor):
        TriggersService._validate_schedule(expr)

    def test_message_names_the_floor_and_the_actual_cadence(self, floor):
        with pytest.raises(TriggerScheduleInvalid) as excinfo:
            TriggersService._validate_schedule("* * * * *")

        message = excinfo.value.message
        assert "at most once every 15 minutes" in message
        assert "every 1 minute" in message
        assert excinfo.value.schedule == "* * * * *"
        assert "15-minute minimum" in excinfo.value.reason

    def test_field_shape_is_still_checked_before_the_floor(self, floor):
        """A malformed expression must fail on its shape, not inside the gap
        scan, so the reason stays actionable."""
        with pytest.raises(TriggerScheduleInvalid) as excinfo:
            TriggersService._validate_schedule("nonsense")
        assert excinfo.value.reason == "not a 5-field cron expression"


class TestFloorIsConfigurable:
    def test_a_higher_floor_rejects_a_previously_valid_cadence(self, monkeypatch):
        monkeypatch.setattr(env.triggers, "schedule_min_interval_minutes", 60)
        with pytest.raises(TriggerScheduleInvalid):
            TriggersService._validate_schedule("*/30 * * * *")
        TriggersService._validate_schedule("0 * * * *")

    def test_a_floor_of_one_admits_every_minute(self, monkeypatch):
        monkeypatch.setattr(env.triggers, "schedule_min_interval_minutes", 1)
        TriggersService._validate_schedule("* * * * *")
