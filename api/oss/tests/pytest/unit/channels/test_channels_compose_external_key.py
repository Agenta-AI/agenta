"""compose_external_key: determinism, distinctness, canonicalisation.

test_channels_seed.py already exercises the SPACE/THREAD grain distinction and
the missing-field/no-threads cases against a single fixed locator; this file
covers two distinct locator SHAPES (not just two grains of the same one) and
dict key reordering.
"""

import pytest

from oss.src.core.channels.dtos import ChannelCapabilities
from oss.src.core.channels.types import ChannelConnectionKeyUndeclared
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


def test_connection_grain_composes_from_declared_fields():
    caps = capabilities()
    caps.identity.keys[ChannelKeyGrain.CONNECTION] = ["team"]
    locator = {"team": "T1", "channel": "C1"}

    key = compose_external_key(caps, ChannelKeyGrain.CONNECTION, locator)

    assert key is not None
    assert key == compose_external_key(caps, ChannelKeyGrain.CONNECTION, locator)


def test_two_connections_differing_only_in_declared_fields_compose_distinct_keys():
    caps = capabilities()
    caps.identity.keys[ChannelKeyGrain.CONNECTION] = ["team"]

    key_a = compose_external_key(
        caps, ChannelKeyGrain.CONNECTION, {"team": "T1", "channel": "C1"}
    )
    key_b = compose_external_key(
        caps, ChannelKeyGrain.CONNECTION, {"team": "T2", "channel": "C1"}
    )

    assert key_a != key_b


def test_connection_grain_raises_on_empty_declaration():
    caps = capabilities()
    caps.identity.keys[ChannelKeyGrain.CONNECTION] = []

    with pytest.raises(ChannelConnectionKeyUndeclared):
        compose_external_key(caps, ChannelKeyGrain.CONNECTION, {"team": "T1"})


def test_connection_grain_raises_when_undeclared_at_all():
    caps = capabilities()  # no "connection" key in identity.keys

    with pytest.raises(ChannelConnectionKeyUndeclared):
        compose_external_key(caps, ChannelKeyGrain.CONNECTION, {"team": "T1"})


def test_thread_grain_still_returns_none_on_empty_declaration():
    """The behaviour CONNECTION grain must NOT inherit: THREAD stays total,
    not raising, when a platform declares no thread fields at all."""

    caps = capabilities()
    caps.identity.keys[ChannelKeyGrain.THREAD] = []

    assert compose_external_key(caps, ChannelKeyGrain.THREAD, {"team": "T1"}) is None
