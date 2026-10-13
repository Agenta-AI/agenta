"""`remaining_musd` in the starter-credits transfer job: exact on valid data, and refusing
anything it would otherwise have to guess."""

import pytest

from entrypoints.migrate_starter_credits_to_wallet import remaining_musd


@pytest.mark.parametrize(
    "info,expected",
    [
        ({"max_budget": 5.0, "spend": 1.25}, 3_750_000),
        ({"max_budget": 5, "spend": 0}, 5_000_000),
        ({"max_budget": 5.0, "spend": 0.1234567}, 4_876_543),
        ({"max_budget": 5.0, "spend": 5.3}, 0),
    ],
)
def test_remaining_is_budget_minus_spend_in_musd(info, expected):
    assert remaining_musd(info) == expected


@pytest.mark.parametrize(
    "info",
    [
        {},
        {"max_budget": 5.0},
        {"spend": 1.0},
        {"max_budget": None, "spend": 1.0},
        {"max_budget": "lots", "spend": 1.0},
        {"max_budget": float("inf"), "spend": 1.0},
        {"max_budget": 5.0, "spend": -1.0},
        {"max_budget": -5.0, "spend": 0.0},
    ],
)
def test_unreadable_budget_or_spend_is_refused(info):
    with pytest.raises(ValueError):
        remaining_musd(info)
