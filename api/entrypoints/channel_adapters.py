"""The first-party channel adapter set, built once for every composition root."""

from typing import Optional
from uuid import UUID

from oss.src.core.channels.adapters.agenta.adapter import AgentaAdapter
from oss.src.core.channels.adapters.bridge.adapter import BridgeAdapter
from oss.src.core.channels.adapters.embed.adapter import EmbedAdapter
from oss.src.core.channels.adapters.mock.adapter import MockAdapter
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.adapters.telegram.adapter import TelegramAdapter
from oss.src.core.channels.adapters.telegram_hosted.adapter import (
    HostedTelegramAdapter,
)
from oss.src.core.channels.adapters.whatsapp.adapter import WhatsAppAdapter
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.access.service import get_access_service
from oss.src.core.access.permissions.types import Permission
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.services.api_key_service import use_api_key


async def _resolve_agenta_api_key_project(raw_key: str) -> Optional[str]:
    """The key's project, or None when the key cannot speak on the agenta
    channel. A post runs the bound agent, so the key's user must hold
    RUN_CHANNELS in that project: without it, any project member's key --
    a viewer's -- could run agents it may not run anywhere else. None refuses
    exactly as an unknown key does. Wired here, not in core, since the
    composition root is where concrete dependencies get built."""

    api_key = await use_api_key(key=raw_key)
    if not api_key:
        return None

    project_id = str(api_key.project_id)
    if api_key.created_by_id is None:
        return None

    # The key is the principal: its record must be active (a key whose creator is
    # gone is refused, as today) and its creator's role must allow RUN_CHANNELS.
    decision = await get_access_service().decide(
        authority=None,
        principal=PrincipalRef(kind=PrincipalKind.API_KEY, id=UUID(str(api_key.id))),
        action=Permission.RUN_CHANNELS,
        project_id=UUID(project_id),
    )
    if not decision.allowed:
        return None

    return project_id


def build_channel_adapter_registry() -> ChannelAdapterRegistry:
    # Stateless: the connection is passed per call, never held. Every bridge
    # shares one registration -- the installation is on the connection.
    return ChannelAdapterRegistry(
        adapters={
            "slack": SlackAdapter(),
            "telegram": TelegramAdapter(),
            "telegram_hosted": HostedTelegramAdapter(),
            "whatsapp": WhatsAppAdapter(),
            "mock": MockAdapter(),
            "bridge": BridgeAdapter(),
            "agenta": AgentaAdapter(
                channels_dao=ChannelsDAO(),
                resolve_project=_resolve_agenta_api_key_project,
            ),
            "embed": EmbedAdapter(),
        }
    )
