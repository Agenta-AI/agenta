from pathlib import Path

import pytest

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.types import ChannelNotSupported

from .contract.fakes import WellBehavedFakeAdapter


def test_get_returns_the_same_instance_passed_in():
    adapter = WellBehavedFakeAdapter()
    registry = ChannelAdapterRegistry(adapters={"fake": adapter})

    assert registry.get("fake") is adapter


def test_get_on_unregistered_key_raises_channel_not_supported():
    registry = ChannelAdapterRegistry(adapters={})

    with pytest.raises(ChannelNotSupported):
        registry.get("nonexistent")


def test_get_on_unregistered_key_does_not_return_none():
    registry = ChannelAdapterRegistry(adapters={"fake": WellBehavedFakeAdapter()})

    try:
        result = registry.get("other")
    except ChannelNotSupported:
        result = "raised"

    assert result == "raised"


def test_keys_and_items():
    slack = WellBehavedFakeAdapter()
    telegram = WellBehavedFakeAdapter()
    registry = ChannelAdapterRegistry(adapters={"slack": slack, "telegram": telegram})

    assert set(registry.keys()) == {"slack", "telegram"}
    assert dict(registry.items()) == {"slack": slack, "telegram": telegram}


_CHANNELS_DIR = Path(__file__).parent

# An adapter held to the contract but absent from both is invisible in both.
_REGISTRY_EXEMPT_CHANNELS: dict = {}


def _channels_with_a_contract_suite() -> set:
    return {
        path.parent.name for path in _CHANNELS_DIR.glob("*/test_*_contract_suite.py")
    }


def test_every_contract_suite_channel_is_registered_or_declared_exempt():
    from entrypoints.channel_adapters import build_channel_adapter_registry

    covered = _channels_with_a_contract_suite()
    assert covered, "no contract-suite channels found under this directory"

    registered = set(build_channel_adapter_registry().keys())

    unaccounted = covered - registered - set(_REGISTRY_EXEMPT_CHANNELS)
    assert not unaccounted, (
        f"{sorted(unaccounted)} have a contract suite but are neither "
        "registered by build_channel_adapter_registry() nor declared in "
        "_REGISTRY_EXEMPT_CHANNELS"
    )

    stale_exemptions = set(_REGISTRY_EXEMPT_CHANNELS) & registered
    assert not stale_exemptions, (
        f"{sorted(stale_exemptions)} are declared exempt but are actually "
        "registered -- drop the stale exemption"
    )
