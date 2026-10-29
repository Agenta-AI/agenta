"""Which channel tools a run gets: the four `CHANNEL_TOOL_OPS`, when the agent is connected
to a Slack or Telegram bot, as far as the bot's settings allow.

A stand-in for the Agenta tools kit, which will own how always-on Agenta tools reach a run.
When the kit lands, it reads the same answer (`POST /api/channels/tools/availability`) and this
module and its one call in `handler.py` go away.
"""

from __future__ import annotations

from typing import List, Optional

import httpx

from agenta.sdk.utils.logging import get_module_logger

from .connection import PlatformConnection
from .session_context import session_context_timeout

log = get_module_logger(__name__)


async def read_channel_tools(
    *,
    workflow_id: Optional[str],
    connection: Optional[PlatformConnection] = None,
) -> List[str]:
    """The channel tool ops the API allows this agent's runs. Empty for a run with no
    workflow artifact, no API, or an agent with no connected bot. A failure is the caller's
    to swallow: the handler runs this under one deadline and adds nothing on failure."""

    if not workflow_id:
        return []
    connection = connection or PlatformConnection()
    api_base = connection.base_url()
    if not api_base:
        return []
    async with httpx.AsyncClient(timeout=session_context_timeout()) as client:
        response = await client.post(
            f"{api_base}/channels/tools/availability",
            json={"artifact_id": str(workflow_id)},
            headers=connection.headers(),
        )
    if response.status_code >= 400:
        log.warning("agent: channel tools check HTTP %s", response.status_code)
        return []
    tools = (response.json() or {}).get("tools") or []
    return [tool for tool in tools if isinstance(tool, str)]
