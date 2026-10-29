"""The check a pasted Claude setup-token passes before the vault stores it.

The model list is free and runs no model. It is the only request Agenta's own services send
with the token: Anthropic refuses model calls that do not come from Claude Code.
"""

from typing import Optional

import httpx

from oss.src.core.secrets.types import (
    SubscriptionTokenRejected,
    SubscriptionTokenUnverified,
)
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

_MODELS_URL = "https://api.anthropic.com/v1/models"
_TIMEOUT_SECONDS = 10.0


class ClaudeTokenClient:
    def __init__(self, *, transport: Optional[httpx.AsyncBaseTransport] = None):
        self._transport = transport

    async def check(self, token: str) -> None:
        """Return when Anthropic accepts the token, raise when it does not or cannot say."""
        try:
            async with httpx.AsyncClient(
                timeout=_TIMEOUT_SECONDS, transport=self._transport
            ) as client:
                response = await client.get(
                    _MODELS_URL,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "anthropic-version": "2023-06-01",
                        "anthropic-beta": "oauth-2025-04-20",
                    },
                )
        except httpx.HTTPError as e:
            log.warning(
                "subscription.token_check",
                outcome="unreachable",
                error=type(e).__name__,
            )
            raise SubscriptionTokenUnverified() from e

        if response.status_code == 200:
            return

        log.warning("subscription.token_check", status=response.status_code)
        if response.status_code in (401, 403):
            raise SubscriptionTokenRejected()
        raise SubscriptionTokenUnverified()
