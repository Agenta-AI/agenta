"""
Unit tests for TestcasesRouter ID-based pagination helpers.

These static methods drive the [A.1] / [B.2] loadable strategies:
  _paginate_ids          — slices a deterministic list of testcase UUIDs
                           using a Windowing cursor (next, limit, order).
  _next_windowing_from_ids — produces the Windowing token for the next page,
                             or None when there is no further page.

Both helpers are pure functions (no I/O) and can be exercised without a
running server or service instances.
"""

from uuid import UUID

import pytest

from oss.src.apis.fastapi.testcases.router import TestcasesRouter
from oss.src.core.shared.dtos import Windowing


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_paginate = TestcasesRouter._paginate_ids
_next_window = TestcasesRouter._next_windowing_from_ids

IDS = [UUID(int=i) for i in range(1, 6)]  # 5 stable test UUIDs


# ---------------------------------------------------------------------------
# _paginate_ids
# ---------------------------------------------------------------------------


class TestPaginateIds:
    def test_no_windowing_returns_all_ids(self):
        ids, has_more = _paginate(ids=IDS, windowing=None)

        assert ids == IDS
        assert has_more is False

    def test_limit_returns_first_n(self):
        ids, has_more = _paginate(ids=IDS, windowing=Windowing(limit=2))

        assert ids == IDS[:2]
        assert has_more is True

    def test_limit_equal_to_count_no_more(self):
        ids, has_more = _paginate(ids=IDS, windowing=Windowing(limit=len(IDS)))

        assert ids == IDS
        assert has_more is False

    def test_limit_larger_than_count_no_more(self):
        ids, has_more = _paginate(ids=IDS, windowing=Windowing(limit=1000))

        assert ids == IDS
        assert has_more is False

    def test_limit_1_returns_only_first_id(self):
        ids, has_more = _paginate(ids=IDS, windowing=Windowing(limit=1))

        assert ids == [IDS[0]]
        assert has_more is True

    def test_no_limit_in_windowing_returns_all(self):
        # Windowing present but no limit → treat as unlimited
        ids, has_more = _paginate(ids=IDS, windowing=Windowing(limit=None))

        assert ids == IDS
        assert has_more is False

    def test_next_cursor_skips_past_given_id(self):
        # next=IDS[1] means "start after IDS[1]"
        ids, has_more = _paginate(ids=IDS, windowing=Windowing(next=IDS[1], limit=10))

        assert ids == IDS[2:]
        assert has_more is False

    def test_next_cursor_with_limit(self):
        ids, has_more = _paginate(ids=IDS, windowing=Windowing(next=IDS[0], limit=2))

        assert ids == IDS[1:3]
        assert has_more is True

    def test_next_cursor_pointing_to_last_element_returns_empty(self):
        ids, has_more = _paginate(ids=IDS, windowing=Windowing(next=IDS[-1], limit=10))

        assert ids == []
        assert has_more is False

    def test_next_cursor_not_in_list_returns_empty(self):
        unknown = UUID(int=999)
        ids, has_more = _paginate(ids=IDS, windowing=Windowing(next=unknown, limit=10))

        assert ids == []
        assert has_more is False

    def test_descending_order_reverses_list(self):
        ids, has_more = _paginate(
            ids=IDS, windowing=Windowing(order="descending", limit=2)
        )

        assert ids == list(reversed(IDS))[:2]
        assert has_more is True

    def test_descending_order_no_limit_returns_reversed(self):
        ids, has_more = _paginate(ids=IDS, windowing=Windowing(order="descending"))

        assert ids == list(reversed(IDS))
        assert has_more is False

    def test_descending_with_next_cursor(self):
        # Reversed list: [IDS[4], IDS[3], IDS[2], IDS[1], IDS[0]]
        # next=IDS[3] → start after position 1, so [IDS[2], IDS[1], IDS[0]]
        ids, has_more = _paginate(
            ids=IDS, windowing=Windowing(order="descending", next=IDS[3], limit=10)
        )

        assert ids == [IDS[2], IDS[1], IDS[0]]
        assert has_more is False

    def test_empty_ids_no_windowing(self):
        ids, has_more = _paginate(ids=[], windowing=None)

        assert ids == []
        assert has_more is False

    def test_empty_ids_with_windowing(self):
        ids, has_more = _paginate(ids=[], windowing=Windowing(limit=5))

        assert ids == []
        assert has_more is False


# ---------------------------------------------------------------------------
# _next_windowing_from_ids
# ---------------------------------------------------------------------------


class TestNextWindowingFromIds:
    def test_has_more_produces_next_cursor_pointing_to_last_paged_id(self):
        paged = IDS[:2]
        window = Windowing(limit=2)

        result = _next_window(paged_ids=paged, windowing=window, has_more=True)

        assert result is not None
        assert result.next == paged[-1]
        assert result.limit == 2

    def test_no_more_returns_none(self):
        result = _next_window(
            paged_ids=IDS,
            windowing=Windowing(limit=10),
            has_more=False,
        )

        assert result is None

    def test_empty_paged_ids_returns_none(self):
        result = _next_window(
            paged_ids=[],
            windowing=Windowing(limit=5),
            has_more=True,
        )

        assert result is None

    def test_no_windowing_returns_none(self):
        result = _next_window(paged_ids=IDS[:2], windowing=None, has_more=True)

        assert result is None

    def test_windowing_without_limit_returns_none(self):
        result = _next_window(
            paged_ids=IDS[:2],
            windowing=Windowing(limit=None),
            has_more=True,
        )

        assert result is None

    def test_preserves_oldest_and_newest_from_original_windowing(self):
        from datetime import datetime, timezone

        oldest = datetime(2024, 1, 1, tzinfo=timezone.utc)
        newest = datetime(2024, 12, 31, tzinfo=timezone.utc)
        window = Windowing(limit=2, oldest=oldest, newest=newest)

        result = _next_window(paged_ids=IDS[:2], windowing=window, has_more=True)

        assert result is not None
        assert result.oldest == oldest
        assert result.newest == newest

    def test_preserves_order_from_original_windowing(self):
        window = Windowing(limit=2, order="descending")

        result = _next_window(paged_ids=IDS[:2], windowing=window, has_more=True)

        assert result is not None
        assert result.order == "descending"

    def test_next_cursor_is_last_id_in_page(self):
        paged = [IDS[0], IDS[1], IDS[2]]
        window = Windowing(limit=3)

        result = _next_window(paged_ids=paged, windowing=window, has_more=True)

        assert result is not None
        assert result.next == IDS[2]

    @pytest.mark.parametrize(
        "has_more,expected_none",
        [
            (True, False),
            (False, True),
        ],
    )
    def test_has_more_flag_determines_none(self, has_more, expected_none):
        result = _next_window(
            paged_ids=IDS[:2],
            windowing=Windowing(limit=2),
            has_more=has_more,
        )

        assert (result is None) == expected_none
