from uuid import uuid4

import pytest

from oss.src.core.channels.identity import (
    ChannelAgentRefused,
    render_agent_refusal,
    refuse_agent,
)
from oss.src.core.channels.types import ChannelAgentNotFound, ChannelAgentNotGranted


def test_refusal_text_is_byte_identical_across_the_three_causes():
    slug = "finance"
    agent_id, space_id = uuid4(), uuid4()

    not_found = refuse_agent(ChannelAgentNotFound(slug=slug), slug=slug)
    granted_nowhere = refuse_agent(None, slug=slug)
    not_granted_here = refuse_agent(
        ChannelAgentNotGranted(agent_id=agent_id, space_id=space_id), slug=slug
    )

    assert not_found.message == granted_nowhere.message == not_granted_here.message
    assert not_found.message == render_agent_refusal(slug=slug)


def test_refusal_names_the_exact_slug_requested():
    slug = "financee"  # a typo matching no real agent

    refusal = refuse_agent(ChannelAgentNotFound(slug=slug), slug=slug)

    assert refusal.message == "No agent named `financee` is available in this space"
    assert refusal.slug == slug


def test_refusal_wording_matches_the_not_granted_case_verbatim_for_a_typo():
    typo_refusal = refuse_agent(ChannelAgentNotFound(slug="finanse"), slug="finanse")
    real_agent_id, real_space_id = uuid4(), uuid4()
    not_granted_refusal = refuse_agent(
        ChannelAgentNotGranted(agent_id=real_agent_id, space_id=real_space_id),
        slug="finanse",
    )

    assert typo_refusal.message == not_granted_refusal.message


def test_internal_causes_stay_distinguishable_for_logging():
    agent_id, space_id = uuid4(), uuid4()

    not_found = ChannelAgentNotFound(slug="finance")
    not_granted = ChannelAgentNotGranted(agent_id=agent_id, space_id=space_id)

    assert isinstance(not_found, ChannelAgentNotFound)
    assert isinstance(not_granted, ChannelAgentNotGranted)
    assert type(not_found) is not type(not_granted)


def test_refuse_agent_rejects_an_unrelated_cause_type():
    with pytest.raises(AssertionError):
        refuse_agent(ValueError("not a channels exception"), slug="finance")


def test_unlinked_state_is_not_worded_as_a_d17_refusal():
    # WP4 owns the actual "not linked" prompt; this only asserts the two
    # sentences never collide, so an unlinked user is never told "no agent
    # exists" when the real issue is that they have not linked at all.
    refusal_text = render_agent_refusal(slug="finance")
    unlinked_text = "You need to link your account before this agent can run."

    assert refusal_text != unlinked_text
    assert "No agent named" not in unlinked_text


def test_channel_agent_refused_is_a_channels_error():
    from oss.src.core.channels.types import ChannelsError

    refusal = ChannelAgentRefused(slug="finance")

    assert isinstance(refusal, ChannelsError)
    assert refusal.message == "No agent named `finance` is available in this space"
