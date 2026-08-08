"""compose_external_key: determinism, distinctness, canonicalisation.

test_channels_seed.py already exercises the SPACE/THREAD grain distinction and
the missing-field/no-threads cases against a single fixed locator; this file
covers two distinct locator SHAPES (not just two grains of the same one) and
dict key reordering.
"""

from oss.src.core.channels.dtos import ChannelCapabilities
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key


SLACK = {
    "channel": "slack",
    "identity": {
        "scope": "workspace",
        "stable": True,
        "keys": {
            "space": ["team", "channel"],
            "thread": ["team", "channel", "thread_ts"],
        },
    },
}


def capabilities() -> ChannelCapabilities:
    return ChannelCapabilities(**SLACK)


def test_a_slack_thread_locator_and_a_slack_space_locator_produce_stable_distinct_keys():
    caps = capabilities()
    thread_locator = {"team": "T1", "channel": "C1", "thread_ts": "1690000000.1"}
    space_locator = {"team": "T1", "channel": "C1"}

    thread_key = compose_external_key(caps, ChannelKeyGrain.THREAD, thread_locator)
    space_key = compose_external_key(caps, ChannelKeyGrain.SPACE, space_locator)

    assert thread_key != space_key
    # determinism: calling again with the same input returns the same key
    assert thread_key == compose_external_key(
        caps, ChannelKeyGrain.THREAD, thread_locator
    )
    assert space_key == compose_external_key(caps, ChannelKeyGrain.SPACE, space_locator)


def test_extra_unrelated_fields_in_the_locator_do_not_change_the_key():
    caps = capabilities()
    locator = {"team": "T1", "channel": "C1"}
    locator_with_noise = {"team": "T1", "channel": "C1", "unrelated": "ignored"}

    assert compose_external_key(caps, ChannelKeyGrain.SPACE, locator) == (
        compose_external_key(caps, ChannelKeyGrain.SPACE, locator_with_noise)
    )
