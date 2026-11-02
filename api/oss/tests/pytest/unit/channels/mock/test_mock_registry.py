"""`registry.get("mock")` resolves `MockAdapter` — a registered channel, not
only a test import. Constructs its own `ChannelAdapterRegistry` the way
`entrypoints/routers.py` does, proving the adapter is registrable through the
normal lookup path.
"""

from oss.src.core.channels.adapters.mock.adapter import MockAdapter
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.types import ChannelNotSupported

import pytest


def test_registry_get_mock_resolves_the_adapter():
    registry = ChannelAdapterRegistry(adapters={"mock": MockAdapter()})

    resolved = registry.get("mock")

    assert isinstance(resolved, MockAdapter)
    assert resolved.channel == "mock"


def test_registry_keys_and_items_include_mock():
    adapter = MockAdapter()
    registry = ChannelAdapterRegistry(adapters={"mock": adapter})

    assert "mock" in registry.keys()
    assert dict(registry.items()) == {"mock": adapter}


def test_registry_raises_channel_not_supported_for_unknown_key():
    registry = ChannelAdapterRegistry(adapters={"mock": MockAdapter()})

    with pytest.raises(ChannelNotSupported):
        registry.get("does-not-exist")
