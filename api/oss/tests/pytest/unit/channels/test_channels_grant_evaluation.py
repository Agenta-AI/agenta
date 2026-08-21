"""`evaluate_grant_effect`: deny-first over a pre-filtered rule set.

Landed ahead of wiring this into `ChannelsService.resolve` and deleting the
old default-deny-on-missing-space branch -- this is the one change in the
grants wave that could OPEN access rather than restrict it if the evaluation
were wrong, so the proof comes first.
"""

from uuid import uuid4

from oss.src.core.channels.dtos import (
    ChannelGrant,
    ChannelGrantData,
    ChannelGrantEffect,
    ChannelGrantFlags,
    ChannelSpaceKind,
)
from oss.src.core.channels.utils import evaluate_grant_effect


def _grant(*, effect, kind=None, space_id=None, is_default=False) -> ChannelGrant:
    return ChannelGrant(
        id=uuid4(),
        agent_id=uuid4(),
        effect=effect,
        kind=kind,
        space_id=space_id,
        data=ChannelGrantData(),
        flags=ChannelGrantFlags(is_default=is_default),
    )


def test_no_rule_refuses():
    assert evaluate_grant_effect([]) is None


def test_kind_allow_admits():
    grants = [_grant(effect=ChannelGrantEffect.ALLOW, kind=ChannelSpaceKind.PRIVATE)]

    assert evaluate_grant_effect(grants) is ChannelGrantEffect.ALLOW


def test_id_deny_beats_kind_allow_regardless_of_order():
    space_id = uuid4()
    grants = [
        _grant(effect=ChannelGrantEffect.ALLOW, kind=ChannelSpaceKind.TOPIC),
        _grant(effect=ChannelGrantEffect.DENY, space_id=space_id),
    ]

    assert evaluate_grant_effect(grants) is ChannelGrantEffect.DENY
    assert evaluate_grant_effect(list(reversed(grants))) is ChannelGrantEffect.DENY


def test_a_deny_with_no_allow_refuses():
    grants = [_grant(effect=ChannelGrantEffect.DENY, kind=ChannelSpaceKind.TOPIC)]

    assert evaluate_grant_effect(grants) is ChannelGrantEffect.DENY


def test_narrow_deny_beats_broad_allow_not_the_other_way():
    """D25's own rule applied to grants: a stated deny wins over a broader
    allow, and this must not be reversible by adding a narrower allow."""

    space_id = uuid4()
    grants = [
        _grant(effect=ChannelGrantEffect.ALLOW, kind=ChannelSpaceKind.TOPIC),
        _grant(effect=ChannelGrantEffect.DENY, space_id=space_id),
        _grant(effect=ChannelGrantEffect.ALLOW, space_id=space_id),
    ]

    assert evaluate_grant_effect(grants) is ChannelGrantEffect.DENY


def test_allow_only_admits_without_any_deny():
    grants = [
        _grant(effect=ChannelGrantEffect.ALLOW, kind=ChannelSpaceKind.PRIVATE),
        _grant(effect=ChannelGrantEffect.ALLOW, space_id=uuid4()),
    ]

    assert evaluate_grant_effect(grants) is ChannelGrantEffect.ALLOW


def test_deny_row_may_not_carry_is_default():
    try:
        _grant(
            effect=ChannelGrantEffect.DENY, kind=ChannelSpaceKind.TOPIC, is_default=True
        )
    except ValueError as e:
        assert "is_default" in str(e)
    else:
        raise AssertionError("a DENY grant with is_default=True must be rejected")


def test_both_kind_and_space_id_null_is_rejected():
    try:
        _grant(effect=ChannelGrantEffect.ALLOW)
    except ValueError as e:
        assert "exactly one" in str(e)
    else:
        raise AssertionError(
            "a grant naming neither kind nor space_id must be rejected"
        )


def test_both_kind_and_space_id_set_is_rejected():
    try:
        _grant(
            effect=ChannelGrantEffect.ALLOW,
            kind=ChannelSpaceKind.TOPIC,
            space_id=uuid4(),
        )
    except ValueError as e:
        assert "exactly one" in str(e)
    else:
        raise AssertionError("a grant naming both kind and space_id must be rejected")
