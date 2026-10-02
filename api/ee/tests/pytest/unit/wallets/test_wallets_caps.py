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
            "Your organization already has 2 agents running, the most the Hobby plan "
            "allows at once. This turn did not start, and you were not charged. Your "
            "running agents keep working. Send your message again when one finishes, or "
            "upgrade to Pro to run 10 at once.",
        ),
        (PRO, "upgrade to Business to run 25 at once."),
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
            "This turn stopped after 30 minutes, the longest turn the Hobby plan allows. "
            "Files the agent saved in its workspace are kept, and you were charged only "
            "for the time it ran. Send a new message to continue from where it stopped, "
            "or upgrade to Pro for turns up to 4 hours.",
        ),
        (PRO, "after 4 hours, the longest turn the Pro plan allows."),
        (BUSINESS, "split the work into smaller turns, or contact us."),
    ],
)
def test_the_turn_length_message(plan, expected):
    assert expected in turn_length_message(plan, turn_caps_for(plan))


@pytest.mark.parametrize(
    "plan,expected",
    [
        (HOBBY, "upgrade to Pro for 2,900 credits a month."),
        (PRO, "Buy credits from $10 for 1,000 credits, or upgrade to Business"),
        (BUSINESS, "Buy credits from $10 for 1,000 credits, or contact us."),
        (None, "Add credits to keep going."),
    ],
)
def test_the_out_of_credit_message(plan, expected):
    message = credit_exhausted_message(plan)
    assert message.startswith(
        "Your organization has used all its credits, so this turn did not start"
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
