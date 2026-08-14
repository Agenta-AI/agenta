"""Unit tests for the pure settlement algorithm in `ee.src.core.wallets.types`:
eligibility/expiry/priority ordering, split funding, restricted-credit exclusion, deficit
creation, and source-derived debit keys. No Postgres, no event loop — `plan_settlement` is
plain Python.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from ee.src.core.wallets.types import (
    DEFICIT_SOURCE,
    compose_debit_key,
    is_resource_eligible,
    plan_settlement,
)
from ee.tests.pytest.utils.wallets.builders import (
    build_credit_candidate,
    build_debit_command,
)

NOW = datetime(2026, 8, 14, 12, 0, 0, tzinfo=timezone.utc)


def test_compose_debit_key_derives_from_posting_key_and_source():
    assert compose_debit_key(idempotency_key="gw_abc", source="wcr_1") == "gw_abc:wcr_1"
    assert (
        compose_debit_key(idempotency_key="gw_abc", source=DEFICIT_SOURCE)
        == "gw_abc:deficit"
    )


def test_is_resource_eligible_general_kind_funds_any_resource():
    assert is_resource_eligible(
        credit_kind="plan_allowance", resource_key="llm:openai:gpt-4"
    )
    assert is_resource_eligible(
        credit_kind="plan_allowance", resource_key="mcp:anything"
    )


def test_is_resource_eligible_restricted_kind_matches_prefix_only():
    assert is_resource_eligible(
        credit_kind="restricted:llm:google:", resource_key="llm:google:gemini-2.5-flash"
    )
    assert not is_resource_eligible(
        credit_kind="restricted:llm:google:", resource_key="llm:openai:gpt-4"
    )


def test_is_resource_eligible_unconfigured_kind_fails_closed():
    assert not is_resource_eligible(
        credit_kind="mystery_kind", resource_key="llm:google:x"
    )


def test_single_general_credit_fully_funds_debit():
    command = build_debit_command(amount_musd=1000)
    candidate = build_credit_candidate(balance_musd=5000)

    plan = plan_settlement(command=command, candidates=[candidate], now=NOW)

    assert len(plan.debit_writes) == 1
    write = plan.debit_writes[0]
    assert write.amount_musd == 1000
    assert write.wallet_credit_id == candidate.wallet_credit_id
    assert write.debit_key == compose_debit_key(
        idempotency_key=command.idempotency_key, source=str(candidate.wallet_credit_id)
    )
    assert plan.credit_balance_deltas == {candidate.wallet_credit_id: 1000}
    assert plan.general_balance_delta == 1000


def test_ordering_lower_priority_number_spends_first():
    command = build_debit_command(amount_musd=1000)
    low_priority = build_credit_candidate(priority=1, balance_musd=5000)
    high_priority = build_credit_candidate(priority=100, balance_musd=5000)

    # Deliberately shuffled input order — plan_settlement must sort itself.
    plan = plan_settlement(
        command=command, candidates=[high_priority, low_priority], now=NOW
    )

    assert len(plan.debit_writes) == 1
    assert plan.debit_writes[0].wallet_credit_id == low_priority.wallet_credit_id


def test_ordering_sooner_end_time_spends_first_when_priority_ties():
    command = build_debit_command(amount_musd=1000)
    soon = build_credit_candidate(
        priority=10, end_time=NOW + timedelta(days=1), balance_musd=5000
    )
    later = build_credit_candidate(
        priority=10, end_time=NOW + timedelta(days=30), balance_musd=5000
    )
    never_expires = build_credit_candidate(
        priority=10, end_time=None, balance_musd=5000
    )

    plan = plan_settlement(
        command=command, candidates=[never_expires, later, soon], now=NOW
    )

    assert plan.debit_writes[0].wallet_credit_id == soon.wallet_credit_id


def test_ordering_credit_id_is_the_final_tiebreak():
    """Both priority and end_time tie — only wallet_credit_id may decide the order."""
    command = build_debit_command(amount_musd=1000)
    shared_end_time = NOW + timedelta(days=10)
    ids = sorted([uuid4(), uuid4(), uuid4()])

    candidates = [
        build_credit_candidate(
            wallet_credit_id=credit_id,
            priority=10,
            end_time=shared_end_time,
            balance_musd=5000,
        )
        for credit_id in reversed(ids)  # shuffled relative to sorted order
    ]

    plan = plan_settlement(command=command, candidates=candidates, now=NOW)

    assert plan.debit_writes[0].wallet_credit_id == ids[0]


def test_expired_credit_is_excluded():
    command = build_debit_command(amount_musd=1000)
    expired = build_credit_candidate(
        end_time=NOW - timedelta(seconds=1), balance_musd=5000
    )
    active = build_credit_candidate(end_time=NOW + timedelta(days=1), balance_musd=5000)

    plan = plan_settlement(command=command, candidates=[expired, active], now=NOW)

    assert len(plan.debit_writes) == 1
    assert plan.debit_writes[0].wallet_credit_id == active.wallet_credit_id


def test_split_funding_across_two_credits():
    command = build_debit_command(amount_musd=1500)
    first = build_credit_candidate(priority=1, balance_musd=1000)
    second = build_credit_candidate(priority=2, balance_musd=1000)

    plan = plan_settlement(command=command, candidates=[first, second], now=NOW)

    assert len(plan.debit_writes) == 2
    assert plan.debit_writes[0].wallet_credit_id == first.wallet_credit_id
    assert plan.debit_writes[0].amount_musd == 1000
    assert plan.debit_writes[1].wallet_credit_id == second.wallet_credit_id
    assert plan.debit_writes[1].amount_musd == 500
    assert plan.credit_balance_deltas == {
        first.wallet_credit_id: 1000,
        second.wallet_credit_id: 500,
    }
    assert plan.general_balance_delta == 1500


def test_restricted_credit_excluded_when_resource_key_does_not_match():
    command = build_debit_command(amount_musd=1000, resource_key="llm:openai:gpt-4")
    restricted = build_credit_candidate(
        priority=1, credit_kind="restricted:llm:google:", balance_musd=5000
    )
    general = build_credit_candidate(
        priority=2, credit_kind="plan_allowance", balance_musd=5000
    )

    plan = plan_settlement(command=command, candidates=[restricted, general], now=NOW)

    assert len(plan.debit_writes) == 1
    assert plan.debit_writes[0].wallet_credit_id == general.wallet_credit_id


def test_deficit_created_when_no_credit_covers_the_full_amount():
    command = build_debit_command(amount_musd=1000)
    partial = build_credit_candidate(balance_musd=400)

    plan = plan_settlement(command=command, candidates=[partial], now=NOW)

    assert len(plan.debit_writes) == 2
    funded, deficit = plan.debit_writes
    assert funded.wallet_credit_id == partial.wallet_credit_id
    assert funded.amount_musd == 400
    assert deficit.wallet_credit_id is None
    assert deficit.amount_musd == 600
    assert deficit.debit_key == compose_debit_key(
        idempotency_key=command.idempotency_key, source=DEFICIT_SOURCE
    )
    assert plan.general_balance_delta == 1000


def test_deficit_only_when_no_candidates_at_all():
    command = build_debit_command(amount_musd=750)

    plan = plan_settlement(command=command, candidates=[], now=NOW)

    assert len(plan.debit_writes) == 1
    assert plan.debit_writes[0].wallet_credit_id is None
    assert plan.debit_writes[0].amount_musd == 750


def test_exhausted_credit_balance_is_skipped():
    command = build_debit_command(amount_musd=500)
    exhausted = build_credit_candidate(priority=1, balance_musd=0)
    funded = build_credit_candidate(priority=2, balance_musd=500)

    plan = plan_settlement(command=command, candidates=[exhausted, funded], now=NOW)

    assert len(plan.debit_writes) == 1
    assert plan.debit_writes[0].wallet_credit_id == funded.wallet_credit_id


def test_every_debit_key_derives_from_source_never_a_sequence():
    """The whole replay invariant: debit_key must be posting key + actual source, so two
    different postings that happen to fund the same credit produce different debit keys,
    and splitting a posting across N credits never produces a "-1", "-2" suffix."""
    credit_a = build_credit_candidate(priority=1, balance_musd=100)
    credit_b = build_credit_candidate(priority=2, balance_musd=1000)

    command = build_debit_command(idempotency_key="gw_xyz", amount_musd=500)
    plan = plan_settlement(command=command, candidates=[credit_a, credit_b], now=NOW)

    keys = [w.debit_key for w in plan.debit_writes]
    assert keys == [
        f"gw_xyz:{credit_a.wallet_credit_id}",
        f"gw_xyz:{credit_b.wallet_credit_id}",
    ]
    # Never a sequence/loop-index suffix appended after the source.
    assert not keys[0].endswith(("-1", "-2", ":1", ":2"))
    assert not keys[1].endswith(("-1", "-2", ":1", ":2"))
