"""The default plan cards state the credit pricing model. Every credit, top-up, concurrency,
project and seat number a card shows must equal the constant that enforces it, so a pricing
change in the wallet or the entitlements fails here until the card says the same thing."""

import pytest

from ee.src.core.access.entitlements.types import (
    AGENT_TURN_CAPS,
    DEFAULT_CATALOG,
    DEFAULT_ENTITLEMENTS,
    PROJECT_LIMITS,
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
STARTER = DefaultPlan.CLOUD_V0_PRO
BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS


def _card(plan: DefaultPlan) -> dict:
    return next(entry for entry in DEFAULT_CATALOG if entry.get("plan") == plan.value)


def _features(plan: DefaultPlan) -> list[str]:
    return _card(plan)["features"]


def _credits(musd: int) -> str:
    return f"{musd // MUSD_PER_CREDIT:,}"


def test_no_card_names_internal_units_or_old_quotas():
    banned = ("agent run", "trace", "evaluation", "sandbox", "workflow")
    for entry in DEFAULT_CATALOG:
        for feature in entry["features"]:
            assert not any(word in feature.lower() for word in banned), feature


def test_the_pro_plan_is_sold_as_starter():
    assert _card(STARTER)["title"] == "Starter"
    assert _card(STARTER)["price"]["base"]["amount"] == 20.00
    assert "Everything in Hobby" in _features(STARTER)
    assert "Everything in Starter" in _features(BUSINESS)


def test_hobby_card_states_the_signup_bonus_projects_and_seats():
    assert (
        f"Limited time: {_credits(SIGNUP_GRANT_AMOUNT_MUSD)} bonus credits "
        "when you sign up"
    ) in _features(HOBBY)
    seats = DEFAULT_ENTITLEMENTS[HOBBY][Tracker.GAUGES][Gauge.USERS].limit
    assert f"{PROJECT_LIMITS[HOBBY.value]} project and {seats} team members" in (
        _features(HOBBY)
    )
    assert STARTER.value not in PROJECT_LIMITS
    assert BUSINESS.value not in PROJECT_LIMITS


def test_every_paid_plan_inherits_the_daily_credits_from_hobby():
    assert (
        f"{_credits(DAILY_FREE_CREDITS_MUSD)} free credits every day, to use that day"
    ) in _features(HOBBY)
    assert {HOBBY.value, STARTER.value, BUSINESS.value} <= DAILY_FREE_CREDIT_PLANS
    assert allowance_musd_for_plan(plan=HOBBY.value) == 0


@pytest.mark.parametrize(
    "plan,credits",
    [(STARTER, "2,000"), (BUSINESS, "32,000")],
)
def test_paid_cards_state_their_monthly_credits(plan, credits):
    allowance = allowance_musd_for_plan(plan=plan.value)
    assert _credits(allowance) == credits
    assert f"{credits} credits a month" in _features(plan)


def test_starter_card_states_the_smallest_top_up_pack():
    smallest = min(TOP_UP_PACKS.values(), key=lambda pack: pack.price_cents)
    assert (
        f"Buy more credits any time: {smallest.credits:,} for "
        f"${smallest.price_cents // 100}"
    ) in _features(STARTER)
    assert not any("Buy more credits" in f for f in _features(HOBBY))


@pytest.mark.parametrize("plan", [HOBBY, STARTER, BUSINESS])
def test_cards_state_the_concurrent_tasks(plan):
    caps = AGENT_TURN_CAPS[plan.value]
    assert f"{caps.concurrent_turns} concurrent tasks" in _features(plan)
