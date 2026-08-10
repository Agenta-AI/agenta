"""The first-party channel adapter set, built once for every composition root."""

from typing import Optional

from oss.src.core.channels.adapters.agenta.adapter import AgentaAdapter
from oss.src.core.channels.adapters.mock.adapter import MockAdapter
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.services.api_key_service import use_api_key


async def _resolve_agenta_api_key_project(raw_key: str) -> Optional[str]:
    """The one DB round trip agenta's verify_signature needs -- wired here,
    not in core, since the composition root is where concrete dependencies
    get built."""

    api_key = await use_api_key(key=raw_key)
    if not api_key:
        return None
    return str(api_key.project_id)


def build_channel_adapter_registry() -> ChannelAdapterRegistry:
    # Stateless: the connection is passed per call, never held. The bridge
    # route resolves its own adapter at runtime and is not registered here.
    return ChannelAdapterRegistry(
        adapters={
            "slack": SlackAdapter(),
            "mock": MockAdapter(),
            "agenta": AgentaAdapter(
                channels_dao=ChannelsDAO(),
                resolve_project=_resolve_agenta_api_key_project,
            ),
        }
    )
