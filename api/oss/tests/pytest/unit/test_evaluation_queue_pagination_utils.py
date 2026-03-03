from uuid import UUID

from oss.src.core.evaluations.utils import (
    paginate_ids,
    next_windowing_from_ids,
    flatten_dedup_ids,
)
from oss.src.core.shared.dtos import Windowing


def _uuid(n: int) -> UUID:
    return UUID(int=n)


def _uuids(start: int, end_inclusive: int) -> list:
    return [_uuid(i) for i in range(start, end_inclusive + 1)]


# -- paginate_ids --------------------------------------------------------------


class TestPaginateIds:
    def test_no_windowing_returns_all_ids(self):
        ids = _uuids(1, 5)

        result, has_more = paginate_ids(ids=ids, windowing=None)

        assert result == ids
        assert has_more is False

    def test_empty_ids_returns_empty(self):
        result, has_more = paginate_ids(ids=[], windowing=None)

        assert result == []
        assert has_more is False

    def test_limit_returns_first_n_ids(self):
        ids = _uuids(1, 5)
        w = Windowing(limit=3)

        result, has_more = paginate_ids(ids=ids, windowing=w)

        assert result == ids[:3]
        assert has_more is True

    def test_limit_equal_to_size_returns_all_no_more(self):
        ids = _uuids(1, 3)
        w = Windowing(limit=3)

        result, has_more = paginate_ids(ids=ids, windowing=w)

        assert result == ids
        assert has_more is False

    def test_limit_larger_than_size_returns_all_no_more(self):
        ids = _uuids(1, 2)
        w = Windowing(limit=10)

        result, has_more = paginate_ids(ids=ids, windowing=w)

        assert result == ids
        assert has_more is False

    def test_cursor_next_skips_to_after_cursor(self):
        ids = _uuids(1, 5)
        w = Windowing(next=ids[1], limit=10)

        result, has_more = paginate_ids(ids=ids, windowing=w)

        assert result == ids[2:]
        assert has_more is False

    def test_cursor_next_with_limit(self):
        ids = _uuids(1, 6)
        w = Windowing(next=ids[1], limit=2)

        result, has_more = paginate_ids(ids=ids, windowing=w)

        assert result == ids[2:4]
        assert has_more is True

    def test_cursor_not_found_returns_empty(self):
        ids = _uuids(1, 5)
        w = Windowing(next=_uuid(999), limit=10)

        result, has_more = paginate_ids(ids=ids, windowing=w)

        assert result == []
        assert has_more is False

    def test_descending_order_reverses_list(self):
        ids = _uuids(1, 5)
        w = Windowing(order="descending", limit=3)

        result, has_more = paginate_ids(ids=ids, windowing=w)

        assert result == list(reversed(ids))[:3]
        assert has_more is True

    def test_no_limit_returns_all_ids(self):
        ids = _uuids(1, 5)
        w = Windowing(order="ascending")

        result, has_more = paginate_ids(ids=ids, windowing=w)

        assert result == ids
        assert has_more is False

    def test_cursor_at_first_returns_rest(self):
        ids = _uuids(1, 4)
        w = Windowing(next=ids[0], limit=10)

        result, has_more = paginate_ids(ids=ids, windowing=w)

        assert result == ids[1:]
        assert has_more is False

    def test_cursor_at_last_returns_empty(self):
        ids = _uuids(1, 4)
        w = Windowing(next=ids[-1], limit=10)

        result, has_more = paginate_ids(ids=ids, windowing=w)

        assert result == []
        assert has_more is False


# -- next_windowing_from_ids ---------------------------------------------------


class TestNextWindowingFromIds:
    def test_no_windowing_returns_none(self):
        ids = _uuids(1, 5)

        result = next_windowing_from_ids(paged_ids=ids, windowing=None, has_more=True)

        assert result is None

    def test_windowing_no_limit_returns_none(self):
        ids = _uuids(1, 5)
        w = Windowing(order="ascending")

        result = next_windowing_from_ids(paged_ids=ids, windowing=w, has_more=True)

        assert result is None

    def test_has_more_false_returns_none(self):
        ids = _uuids(1, 3)
        w = Windowing(limit=3)

        result = next_windowing_from_ids(paged_ids=ids, windowing=w, has_more=False)

        assert result is None

    def test_empty_ids_returns_none(self):
        w = Windowing(limit=3)

        result = next_windowing_from_ids(paged_ids=[], windowing=w, has_more=True)

        assert result is None

    def test_returns_cursor_pointing_to_last_paged_id(self):
        ids = _uuids(1, 3)
        w = Windowing(limit=3)

        result = next_windowing_from_ids(paged_ids=ids, windowing=w, has_more=True)

        assert result is not None
        assert result.next == ids[-1]
        assert result.limit == 3

    def test_preserves_order_in_next_windowing(self):
        ids = _uuids(1, 3)
        w = Windowing(limit=3, order="descending")

        result = next_windowing_from_ids(paged_ids=ids, windowing=w, has_more=True)

        assert result is not None
        assert result.order == "descending"

    def test_preserves_limit_in_next_windowing(self):
        ids = _uuids(1, 5)
        w = Windowing(limit=5)

        result = next_windowing_from_ids(paged_ids=ids, windowing=w, has_more=True)

        assert result is not None
        assert result.limit == 5


# -- flatten_dedup_ids ---------------------------------------------------------


class TestFlattenDedupIds:
    def test_empty_input_returns_empty(self):
        result = flatten_dedup_ids([])

        assert result == []

    def test_single_group_preserved(self):
        ids = _uuids(1, 3)

        result = flatten_dedup_ids([ids])

        assert result == ids

    def test_multiple_groups_no_overlap_concatenated(self):
        group_a = _uuids(1, 3)
        group_b = _uuids(4, 6)

        result = flatten_dedup_ids([group_a, group_b])

        assert result == group_a + group_b

    def test_overlapping_groups_deduplicates(self):
        group_a = [_uuid(1), _uuid(2), _uuid(3)]
        group_b = [_uuid(2), _uuid(3), _uuid(4)]

        result = flatten_dedup_ids([group_a, group_b])

        assert result == [_uuid(1), _uuid(2), _uuid(3), _uuid(4)]

    def test_preserves_first_seen_order(self):
        group_a = [_uuid(3), _uuid(1)]
        group_b = [_uuid(1), _uuid(2)]

        result = flatten_dedup_ids([group_a, group_b])

        assert result == [_uuid(3), _uuid(1), _uuid(2)]

    def test_empty_inner_groups_ignored(self):
        ids = _uuids(1, 2)

        result = flatten_dedup_ids([[], ids, []])

        assert result == ids

    def test_all_empty_groups_returns_empty(self):
        result = flatten_dedup_ids([[], [], []])

        assert result == []

    def test_full_overlap_returns_single_copy(self):
        ids = _uuids(1, 3)

        result = flatten_dedup_ids([ids, ids, ids])

        assert result == ids

    def test_three_groups_merged_in_order(self):
        group_a = [_uuid(1)]
        group_b = [_uuid(1), _uuid(2)]
        group_c = [_uuid(2), _uuid(3)]

        result = flatten_dedup_ids([group_a, group_b, group_c])

        assert result == [_uuid(1), _uuid(2), _uuid(3)]
