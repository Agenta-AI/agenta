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
