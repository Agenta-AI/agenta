from uuid import UUID

from oss.src.core.evaluations.utils import filter_scenario_ids


def _uuid(n: int) -> UUID:
    return UUID(int=n)


def _uuids(start: int, end_inclusive: int) -> list[UUID]:
    return [_uuid(i) for i in range(start, end_inclusive + 1)]


def test_sequential_single_repeat_even_split_default_batch_size():
    """
    Parameters:
    | before  | -       | parameter    |
    |---------|---------|--------------|
    | A, B    |         | users (r0)   |
    | 6       |         | scenarios    |
    | 120     |         | batch size   |
    | 0       |         | batch offset |

    Results:
    | before  | -       | scenario |
    |---------|---------|----------|
    | r0 |    |    |    |          |
    |----|----|----|----|----------|
    | A  |    |    |    |        1 |
    | A  |    |    |    |        2 |
    | A  |    |    |    |        3 |
    | B  |    |    |    |        4 |
    | B  |    |    |    |        5 |
    | B  |    |    |    |        6 |
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    scenarios = _uuids(1, 6)

    user_1_slice = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=True,
    )
    user_2_slice = filter_scenario_ids(
        user_id=user_2,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=True,
    )

    assert user_1_slice == [scenarios[:3]]
    assert user_2_slice == [scenarios[3:]]


def test_randomized_single_repeat_uuid_mod_split_default_batch_size():
    """
    Parameters:
    | before  | -       | parameter    |
    |---------|---------|--------------|
    | A, B    |         | users (r0)   |
    | 6       |         | scenarios    |
    | 120     |         | batch size   |
    | 0       |         | batch offset |

    Results:
    | before  | -       | scenario |
    |---------|---------|----------|
    | r0 |    |    |    |          |
    |----|----|----|----|----------|
    | A  |    |    |    |        1 |
    | A  |    |    |    |        2 |
    | B  |    |    |    |        3 |
    | B  |    |    |    |        4 |
    | B  |    |    |    |        5 |
    | A  |    |    |    |        6 |
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    scenarios = [_uuid(1), _uuid(61), _uuid(2), _uuid(62), _uuid(3), _uuid(63)]

    user_1_slice = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=False,
    )
    user_2_slice = filter_scenario_ids(
        user_id=user_2,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=False,
    )

    assert user_1_slice == [[scenarios[0], scenarios[2], scenarios[4]]]
    assert user_2_slice == [[scenarios[1], scenarios[3], scenarios[5]]]


def test_sequential_repeats_are_independent_and_respect_user_order_per_repeat():
    """
    Parameters:
    | before  | -       | parameter    |
    |---------|---------|--------------|
    | A, B    |         | users (r0)   |
    | B, A    |         | users (r1)   |
    | 6       |         | scenarios    |
    | 120     |         | batch size   |
    | 0       |         | batch offset |

    Results:
    | before  | -       | scenario |
    |---------|---------|----------|
    | r0 | r1 |    |    |          |
    |----|----|----|----|----------|
    | A  | B  |    |    |        1 |
    | A  | B  |    |    |        2 |
    | A  | B  |    |    |        3 |
    | B  | A  |    |    |        4 |
    | B  | A  |    |    |        5 |
    | B  | A  |    |    |        6 |
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    scenarios = _uuids(1, 6)

    user_1_slices = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2], [user_2, user_1]],
        scenario_ids=scenarios,
        is_sequential=True,
    )
    user_2_slices = filter_scenario_ids(
        user_id=user_2,
        user_ids=[[user_1, user_2], [user_2, user_1]],
        scenario_ids=scenarios,
        is_sequential=True,
    )

    assert user_1_slices == [scenarios[:3], scenarios[3:]]
    assert user_2_slices == [scenarios[3:], scenarios[:3]]


def test_randomized_repeats_are_independent_and_respect_user_order_per_repeat():
    """
    Parameters:
    | before | -       | parameter    |
    |--------|---------|--------------|
    | A, B   |         | users (r0)   |
    | B, A   |         | users (r1)   |
    | 6      |         | scenarios    |
    | 120    |         | batch size   |
    | 0      |         | batch offset |

    Results:
    | before  | -       | scenario |
    |---------|---------|----------|
    | r0 | r1 |    |    |          |
    |----|----|----|----|----------|
    | A  | B  |    |    |        1 |
    | A  | B  |    |    |        2 |
    | B  | A  |    |    |        3 |
    | B  | A  |    |    |        4 |
    | B  | A  |    |    |        5 |
    | A  | B  |    |    |        6 |
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    scenarios = [_uuid(1), _uuid(61), _uuid(2), _uuid(62), _uuid(3), _uuid(63)]

    user_1_slices = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2], [user_2, user_1]],
        scenario_ids=scenarios,
        is_sequential=False,
    )
    user_2_slices = filter_scenario_ids(
        user_id=user_2,
        user_ids=[[user_1, user_2], [user_2, user_1]],
        scenario_ids=scenarios,
        is_sequential=False,
    )

    assert user_1_slices == [
        [scenarios[0], scenarios[2], scenarios[4]],
        [scenarios[1], scenarios[3], scenarios[5]],
    ]
    assert user_2_slices == [
        [scenarios[1], scenarios[3], scenarios[5]],
        [scenarios[0], scenarios[2], scenarios[4]],
    ]


def test_sequential_adding_users_changes_assignments():
    """
    Parameters:
    | before  | after   | parameter    |
    |---------|---------|--------------|
    | A, B    | A, B, C | users (r0)   |
    | 8       | 8       | scenarios    |
    | 8       | 8       | batch size   |
    | 0       | 0       | batch offset |

    Results:
    | before  | after   | scenario |
    |---------|---------|----------|
    | r0 |    | r0 |    |          |
    |----|----|----|----|----------|
    | A  |    | A  |    |        1 |
    | A  |    | A  |    |        2 |
    | A  |    | A  |    |        3 |
    | A  |    | B  |    |        4 |  # changed
    | B  |    | B  |    |        5 |
    | B  |    | B  |    |        6 |
    | B  |    | C  |    |        7 |  # changed
    | B  |    | C  |    |        8 |  # changed
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    user_3 = _uuid(1003)
    scenarios = _uuids(1, 8)

    before = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=True,
        batch_size=8,
    )
    after = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2, user_3]],
        scenario_ids=scenarios,
        is_sequential=True,
        batch_size=8,
    )

    assert before == [scenarios[:4]]
    assert after == [scenarios[:3]]


def test_randomized_adding_users_changes_assignments():
    """
    Parameters:
    | before | after   | parameter    |
    |--------|---------|--------------|
    | A, B   | A, B, C | users (r0)   |
    | 8      | 8       | scenarios    |
    | 8      | 8       | batch size   |
    | 0      | 0       | batch offset |

    Results:
    | before  | after   | scenario |
    |---------|---------|----------|
    | r0 |    | r0 |    |          |
    |----|----|----|----|----------|
    | A  |    | A  |    |        1 |
    | A  |    | A  |    |        2 |
    | A  |    | B  |    |        3 |  # changed
    | B  |    | B  |    |        4 |
    | B  |    | B  |    |        5 |
    | B  |    | C  |    |        6 |  # changed
    | B  |    | C  |    |        7 |  # changed
    | A  |    | A  |    |        8 |
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    user_3 = _uuid(1003)
    scenarios = [
        _uuid(1),
        _uuid(41),
        _uuid(81),
        _uuid(2),
        _uuid(42),
        _uuid(82),
        _uuid(3),
        _uuid(43),
    ]

    before = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=False,
        batch_size=8,
    )
    after = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2, user_3]],
        scenario_ids=scenarios,
        is_sequential=False,
        batch_size=8,
    )

    assert _uuid(41) in before[0]
    assert _uuid(41) not in after[0]


def test_sequential_reordering_users_changes_assignments():
    """
    Parameters:
    | before  | after   | parameter    |
    |---------|---------|--------------|
    | A, B, C | B, A, C | users (r0)   |
    | 8       | 8       | scenarios    |
    | 8       | 8       | batch size   |
    | 0       | 0       | batch offset |

    Results:
    | before  | after   | scenario |
    |---------|---------|----------|
    | r0 |    | r0 |    |          |
    |----|----|----|----|----------|
    | A  |    | B  |    |        1 |  # changed
    | A  |    | B  |    |        2 |  # changed
    | A  |    | B  |    |        3 |  # changed
    | B  |    | A  |    |        4 |  # changed
    | B  |    | A  |    |        5 |  # changed
    | B  |    | A  |    |        6 |  # changed
    | C  |    | C  |    |        7 |
    | C  |    | C  |    |        8 |
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    user_3 = _uuid(1003)
    scenarios = _uuids(1, 8)

    before = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2, user_3]],
        scenario_ids=scenarios,
        is_sequential=True,
        batch_size=8,
    )
    after = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_2, user_1, user_3]],
        scenario_ids=scenarios,
        is_sequential=True,
        batch_size=8,
    )

    # With MOD=8 and 3 users, block sizes are [3, 3, 2].
    assert before == [scenarios[:3]]
    assert after == [scenarios[3:6]]


def test_randomized_reordering_users_changes_assignments():
    """
    Parameters:
    | before  | after   | parameter    |
    |---------|---------|--------------|
    | A, B, C | B, A, C | users (r0)   |
    | 8       | 8       | scenarios    |
    | 8       | 8       | batch size   |
    | 0       | 0       | batch offset |

    Results:
    | before  | after   | scenario |
    |---------|---------|----------|
    | r0 |    | r0 |    |          |
    |----|----|----|----|----------|
    | A  |    | B  |    |        1 |  # changed
    | A  |    | B  |    |        2 |  # changed
    | B  |    | A  |    |        3 |  # changed
    | B  |    | A  |    |        4 |  # changed
    | B  |    | A  |    |        5 |  # changed
    | C  |    | C  |    |        6 |
    | C  |    | C  |    |        7 |
    | A  |    | B  |    |        8 |  # changed
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    user_3 = _uuid(1003)
    scenarios = [
        _uuid(1),
        _uuid(41),
        _uuid(81),
        _uuid(2),
        _uuid(42),
        _uuid(82),
        _uuid(3),
        _uuid(83),
    ]

    before = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2, user_3]],
        scenario_ids=scenarios,
        is_sequential=False,
        batch_size=8,
    )
    after = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_2, user_1, user_3]],
        scenario_ids=scenarios,
        is_sequential=False,
        batch_size=8,
    )

    assert _uuid(1) in before[0]
    assert _uuid(1) not in after[0]
    assert _uuid(41) not in before[0]
    assert _uuid(41) in after[0]


def test_sequential_batch_size_changes_assignment():
    """
    Parameters:
    | before | after | parameter    |
    |--------|-------|--------------|
    | A, B   | A, B  | users (r0)   |
    | 8      | 8     | scenarios    |
    | 8      | 4     | batch size   |
    | 0      | 0     | batch offset |

    Results:
    | before  | after   | scenario |
    |---------|---------|----------|
    | r0 |    | r0 |    |          |
    |----|----|----|----|----------|
    | A  |    | A  |    |        1 |
    | A  |    | A  |    |        2 |
    | A  |    | B  |    |        3 |  # changed
    | A  |    | B  |    |        4 |  # changed
    | B  |    | A  |    |        5 |  # changed
    | B  |    | A  |    |        6 |  # changed
    | B  |    | B  |    |        7 |
    | B  |    | B  |    |        8 |
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    scenarios = _uuids(1, 8)

    before = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=True,
        batch_size=8,
    )[0]
    after = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=True,
        batch_size=4,
    )[0]

    assert before != after


def test_randomized_batch_size_has_no_effect_on_assignments():
    """
    Parameters:
    | before | after | parameter    |
    |--------|-------|--------------|
    | A, B   | A, B  | users (r0)   |
    | 6      | 6     | scenarios    |
    | 4      | 999   | batch size   |
    | 0      | 0     | batch offset |

    Results:
    | before  | after   | scenario |
    |---------|---------|----------|
    | r0 |    | r0 |    |          |
    |----|----|----|----|----------|
    | A  |    | A  |    |        1 |
    | A  |    | A  |    |        2 |
    | B  |    | B  |    |        3 |
    | B  |    | B  |    |        4 |
    | B  |    | B  |    |        5 |
    | A  |    | A  |    |        6 |
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    scenarios = [_uuid(1), _uuid(61), _uuid(2), _uuid(62), _uuid(3), _uuid(63)]

    before = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=False,
        batch_size=4,
    )[0]
    after = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=False,
        batch_size=999,
    )[0]

    assert after == before


def test_sequential_adding_scenarios_preserves_existing_assignments():
    """
    Parameters:
    | before | after | parameter    |
    |--------|-------|--------------|
    | A, B   | A, B  | users (r0)   |
    | 4      | 6     | scenarios    |
    | 4      | 4     | batch size   |
    | 0      | 0     | batch offset |

    Results:
    | before  | after   | scenario |
    |---------|---------|----------|
    | r0 |    | r0 |    |          |
    |----|----|----|----|----------|
    | A  |    | A  |    |        1 |
    | A  |    | A  |    |        2 |
    | B  |    | B  |    |        3 |
    | B  |    | B  |    |        4 |
    |    |    | A  |    |        5 |  # new
    |    |    | A  |    |        6 |  # new
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    base = _uuids(1, 4)
    grown = _uuids(1, 6)

    before = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=base,
        is_sequential=True,
        batch_size=4,
    )[0]
    after = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=grown,
        is_sequential=True,
        batch_size=4,
    )[0]

    assert before == [base[0], base[1]]
    assert set(before).issubset(set(after))


def test_randomized_adding_scenarios_preserves_existing_assignment():
    """
    Parameters:
    | before | after | parameter    |
    |--------|-------|--------------|
    | A, B   | A, B  | users (r0)   |
    | 6      | 7     | scenarios    |
    | 10     | 10    | batch size   |
    | 0      | 0     | batch offset |

    Results:
    | before  | after   | scenario |
    |---------|---------|----------|
    | r0 |    | r0 |    |          |
    |----|----|----|----|----------|
    | A  |    | A  |    |        1 |
    | B  |    | B  |    |        2 |
    | A  |    | A  |    |        3 |
    | B  |    | B  |    |        4 |
    | A  |    | A  |    |        5 |
    | B  |    | B  |    |        6 |
    |    |    | A  |    |        7 |  # new
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    base = [_uuid(1), _uuid(61), _uuid(2), _uuid(62), _uuid(3), _uuid(63)]
    grown = [*base, _uuid(4)]

    before = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=base,
        is_sequential=False,
        batch_size=10,
    )[0]
    after = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=grown,
        is_sequential=False,
        batch_size=10,
    )[0]

    assert set(before).issubset(set(after))


def test_sequential_batch_offset_rotates_assignments():
    """
    Parameters:
    | before | after | parameter    |
    |--------|-------|--------------|
    | A, B   | A, B  | users (r0)   |
    | 6      | 6     | scenarios    |
    | 6      | 6     | batch size   |
    | 0      | 2     | batch offset |

    Results:
    | before  | after   | scenario |
    |---------|---------|----------|
    | r0 |    | r0 |    |          |
    |----|----|----|----|----------|
    | A  |    | A  |    |        1 |
    | A  |    | B  |    |        2 |  # changed
    | A  |    | B  |    |        3 |  # changed
    | B  |    | B  |    |        4 |
    | B  |    | A  |    |        5 |  # changed
    | B  |    | A  |    |        6 |  # changed
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    scenarios = _uuids(1, 6)

    without_offset = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=True,
        batch_size=6,
    )
    with_offset = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=True,
        batch_size=6,
        batch_offset=2,
    )

    assert without_offset == [scenarios[:3]]
    assert with_offset == [[scenarios[0], scenarios[4], scenarios[5]]]


def test_randomized_batch_offset_has_no_effect_on_assignments():
    """
    Parameters:
    | before | after | parameter    |
    |--------|-------|--------------|
    | A, B   | A, B  | users (r0)   |
    | 6      | 6     | scenarios    |
    | 6      | 6     | batch size   |
    | 0      | 999   | batch offset |

    Results:
    | before  | after   | scenario |
    |---------|---------|----------|
    | r0 |    | r0 |    |          |
    |----|----|----|----|----------|
    | A  |    | A  |    |        1 |
    | A  |    | A  |    |        2 |
    | B  |    | B  |    |        3 |
    | B  |    | B  |    |        4 |
    | B  |    | B  |    |        5 |
    | A  |    | A  |    |        6 |
    """
    user_1 = _uuid(1001)
    user_2 = _uuid(1002)
    scenarios = [_uuid(1), _uuid(61), _uuid(2), _uuid(62), _uuid(3), _uuid(63)]

    without_offset = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=False,
        batch_size=6,
    )
    with_offset = filter_scenario_ids(
        user_id=user_1,
        user_ids=[[user_1, user_2]],
        scenario_ids=scenarios,
        is_sequential=False,
        batch_size=6,
        batch_offset=999,
    )

    assert with_offset == without_offset
