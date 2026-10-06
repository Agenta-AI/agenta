"""The default plan cards state the credit pricing model. Every number a card shows must
equal the constant that enforces it, so a pricing change in the wallet or the
entitlements fails here until the card says the same thing."""

import pytest

from ee.src.core.access.entitlements.types import (
    AGENT_TURN_CAPS,
    DEFAULT_CATALOG,
    DEFAULT_ENTITLEMENTS,
    REPORTS,
    Counter,
    DefaultPlan,
    Gauge,
    Tracker,
)
from ee.src.core.wallets.grants import (
    DAILY_FREE_CREDITS_MUSD,
    SIGNUP_GRANT_AMOUNT_MUSD,
)
from ee.src.core.wallets.plans import (
    DAILY_FREE_CREDIT_PLANS,
    allowance_musd_for_plan,
)
from ee.src.core.wallets.purchases import MUSD_PER_CREDIT, TOP_UP_PACKS

HOBBY = DefaultPlan.CLOUD_V0_HOBBY
PRO = DefaultPlan.CLOUD_V0_PRO
BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS


def _card(plan: DefaultPlan) -> dict:
    return next(entry for entry in DEFAULT_CATALOG if entry.get("plan") == plan.value)


def _features(plan: DefaultPlan) -> list[str]:
    return _card(plan)["features"]


def _credits(musd: int) -> str:
    return f"{musd // MUSD_PER_CREDIT:,}"


def _duration(seconds: int) -> str:
    hours, rest = divmod(seconds, 3600)
    if hours and not rest:
        return f"{hours} hour" if hours == 1 else f"{hours} hours"
    return f"{seconds // 60} minutes"


def test_no_card_sells_agent_runs():
    for entry in DEFAULT_CATALOG:
        for feature in entry["features"]:
            assert "agent run" not in feature.lower(), feature


def test_one_credit_is_one_cent():
    assert MUSD_PER_CREDIT == 10_000
    for plan in (HOBBY, PRO):
        assert "1 credit = $0.01, spent on built-in models and sandbox time" in (
            _features(plan)
        )


def test_hobby_card_states_signup_and_daily_credits():
    signup_dollars = SIGNUP_GRANT_AMOUNT_MUSD // 1_000_000
    assert (
        f"${signup_dollars} of credits at signup "
        f"({_credits(SIGNUP_GRANT_AMOUNT_MUSD)} credits)"
    ) in _features(HOBBY)
    assert (
        f"{_credits(DAILY_FREE_CREDITS_MUSD)} free credits every day, "
        "reset at midnight UTC, no rollover"
    ) in _features(HOBBY)
    assert DAILY_FREE_CREDIT_PLANS == frozenset({HOBBY.value})
    assert allowance_musd_for_plan(plan=HOBBY.value) == 0


@pytest.mark.parametrize("plan", [PRO, BUSINESS])
def test_paid_cards_state_monthly_credits_equal_to_the_price(plan):
    allowance = allowance_musd_for_plan(plan=plan.value)
    assert f"{_credits(allowance)} credits every month" in _features(plan)
    # Option E: a paid plan's monthly credits equal its price.
    price = _card(plan)["price"]["base"]["amount"]
    assert allowance == round(price * 1_000_000)


def test_pro_card_states_the_smallest_top_up_pack():
    smallest = min(TOP_UP_PACKS.values(), key=lambda pack: pack.price_cents)
    assert (
        f"Buy more credits: ${smallest.price_cents // 100} for "
        f"{smallest.credits:,} credits"
    ) in _features(PRO)
    # Business inherits it through "Everything in Pro"; Hobby cannot buy top-ups.
    assert "Everything in Pro" in _features(BUSINESS)
    assert not any("Buy more credits" in f for f in _features(HOBBY))


@pytest.mark.parametrize("plan", [HOBBY, PRO, BUSINESS])
def test_cards_state_the_agent_turn_caps(plan):
    caps = AGENT_TURN_CAPS[plan.value]
    assert (
        f"{caps.concurrent_turns} agents at once, up to "
        f"{_duration(caps.max_turn_seconds)} per request"
    ) in _features(plan)


def test_cards_state_the_platform_quotas_they_keep():
    hobby = DEFAULT_ENTITLEMENTS[HOBBY][Tracker.COUNTERS]
    assert f"{hobby[Counter.TRACES_INGESTED].limit:,} traces / month" in (
        _features(HOBBY)
    )
    assert f"{hobby[Counter.EVALUATIONS_RUN].limit} evaluations / month" in (
        _features(HOBBY)
    )
    seats = DEFAULT_ENTITLEMENTS[HOBBY][Tracker.GAUGES][Gauge.USERS].limit
    assert f"{seats} team members" in _features(HOBBY)

    # Paid plans: traces are metered to Stripe past the free tier, at the tiered price
    # the card states.
    assert REPORTS[Counter.TRACES_INGESTED.value] == "traces"
    for plan in (PRO, BUSINESS):
        traces = DEFAULT_ENTITLEMENTS[plan][Tracker.COUNTERS][Counter.TRACES_INGESTED]
        assert traces.limit is None
        tiers = _card(plan)["price"]["traces"]["tiers"]
        assert tiers[0]["limit"] == traces.free
        assert (
            f"{traces.free:,} traces / month included, then "
            f"${tiers[1]['amount']:.0f} per additional {tiers[1]['rate']:,}"
        ) in _features(plan)
