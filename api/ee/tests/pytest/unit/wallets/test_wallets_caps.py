"""The lines a person reads when a turn meets a plan limit: each names the limit, the
plan's number, what happened to the work, and what to do next."""

import pytest

from ee.src.core.access.entitlements.types import (
    BUSINESS_AGENT_TURN_CAPS,
    HOBBY_AGENT_TURN_CAPS,
    PRO_AGENT_TURN_CAPS,
)
from ee.src.core.wallets.caps import (
    concurrent_turns_message,
    credit_exhausted_message,
    turn_caps_for,
    turn_length_message,
)

HOBBY = "cloud_v0_hobby"
PRO = "cloud_v0_pro"
BUSINESS = "cloud_v0_business"


def test_only_the_three_cloud_plans_are_capped():
    assert turn_caps_for(HOBBY) == HOBBY_AGENT_TURN_CAPS
    assert turn_caps_for(PRO) == PRO_AGENT_TURN_CAPS
    assert turn_caps_for(BUSINESS) == BUSINESS_AGENT_TURN_CAPS
    assert turn_caps_for("cloud_v0_agenta_ai") is None
    assert turn_caps_for("self_hosted_enterprise") is None
    assert turn_caps_for(None) is None


@pytest.mark.parametrize(
    "plan,expected",
    [
        (
            HOBBY,
            "Your Hobby plan allows 2 concurrent tasks, and 2 are running. We didn't "
            "start this task or charge you. Resend when one finishes, or upgrade "
            "to Starter for 20 at a time.",
        ),
        (PRO, "upgrade to Business for 50 at a time."),
        (BUSINESS, "contact us to raise the limit."),
    ],
)
def test_the_concurrency_message(plan, expected):
    message = concurrent_turns_message(plan, turn_caps_for(plan))
    assert message.endswith(expected)


@pytest.mark.parametrize(
    "plan,expected",
    [
        (
            HOBBY,
            "The Hobby plan limits a task to 30 minutes. This one reached it, so we "
            "stopped it. Saved work is kept, and you paid only for the time used. Send "
            "a message to continue, or upgrade to Starter for up to 4 hours.",
        ),
        (PRO, "The Starter plan limits a task to 4 hours."),
        (BUSINESS, "to continue, or split the work into smaller tasks."),
    ],
)
def test_the_turn_length_message(plan, expected):
    assert expected in turn_length_message(plan, turn_caps_for(plan))


@pytest.mark.parametrize(
    "plan,expected",
    [
        (
            HOBBY,
            "Free daily credits come back at midnight UTC, up to 10 days a month, "
            "or upgrade to Starter for 2,000 credits a month.",
        ),
        (
            PRO,
            "Buy more credits to keep going, or upgrade to Business for 32,000 credits a month.",
        ),
        (BUSINESS, "Buy more credits to keep going, or contact us."),
        (None, "Add credits to keep going."),
    ],
)
def test_the_out_of_credit_message(plan, expected):
    message = credit_exhausted_message(plan)
    assert message.startswith(
        "You've used all your organization's credits, so we didn't start this task"
    )
    assert expected in message


def test_every_message_is_one_line():
    # The SDK keeps only the first line of a runner error.
    for plan in (HOBBY, PRO, BUSINESS):
        caps = turn_caps_for(plan)
        for message in (
            concurrent_turns_message(plan, caps),
            turn_length_message(plan, caps),
            credit_exhausted_message(plan),
        ):
            assert "\n" not in message
