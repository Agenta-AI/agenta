"""The first-party channel adapter set, built once for every composition root."""

from oss.src.core.channels.adapters.mock.adapter import MockAdapter
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.slack.adapter import SlackAdapter


def build_channel_adapter_registry() -> ChannelAdapterRegistry:
    # Stateless: the connection is passed per call, never held. The bridge
    # route resolves its own adapter at runtime and is not registered here.
    return ChannelAdapterRegistry(
        adapters={
            "slack": SlackAdapter(),
            "mock": MockAdapter(),
        }
    )
