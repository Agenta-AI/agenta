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
            "Your Free plan can run 2 agents at the same time, and 2 are already "
            "working. We didn't start this request, and you weren't charged. Send it "
            "again when one of them finishes, or upgrade to Pro to run 10 agents at "
            "the same time.",
        ),
        (PRO, "upgrade to Business to run 25 agents at the same time."),
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
            "On the Free plan, an agent can work on one request for up to 30 minutes. "
            "This request reached that limit, so we stopped it. Anything the agent "
            "already saved is kept, and you only paid for the time it worked. Send a "
            "new message to let it continue, or upgrade to Pro for requests up to 4 hours.",
        ),
        (PRO, "On the Pro plan, an agent can work on one request for up to 4 hours."),
        (BUSINESS, "to let it continue, or split the work into smaller requests."),
    ],
)
def test_the_turn_length_message(plan, expected):
    assert expected in turn_length_message(plan, turn_caps_for(plan))


@pytest.mark.parametrize(
    "plan,expected",
    [
        (
            HOBBY,
            "come back at midnight UTC, or upgrade to Pro for 2,900 credits a month.",
        ),
        (
            PRO,
            "Buy more credits to keep going, or upgrade to Business for 29,900 credits a month.",
        ),
        (BUSINESS, "Buy more credits to keep going, or contact us."),
        (None, "Add credits to keep going."),
    ],
)
def test_the_out_of_credit_message(plan, expected):
    message = credit_exhausted_message(plan)
    assert message.startswith(
        "Your organization has used all its credits, so we didn't start this request"
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
