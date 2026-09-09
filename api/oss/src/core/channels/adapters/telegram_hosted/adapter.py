from typing import Any, Dict, Optional

from oss.src.core.channels.adapters.telegram.adapter import TelegramAdapter
from oss.src.core.channels.adapters.telegram.signature import verify_telegram_secret
from oss.src.core.channels.adapters.telegram_hosted.capabilities import (
    fetch_telegram_hosted_capabilities,
)
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelRequestContext,
)
from oss.src.core.channels.types import ChannelSignatureInvalid
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def _connection_project(connection: ChannelConnection) -> Optional[str]:
    data = connection.data if isinstance(connection.data, dict) else {}
    locator = data.get("connection_locator")
    if isinstance(locator, dict) and locator.get("project"):
        return str(locator["project"])
    return None


class HostedTelegramAdapter(TelegramAdapter):
    """The Agenta-owned Telegram bot. One bot serves every project, so a
    connection keys on the project, not the bot id, and the shared ingress
    resolves the chat to a project from the bind map. The transport, parsing,
    and rendering are the custom bot's, inherited unchanged. Only what the
    shared bot must do differently is overridden here:

    - egress uses the one deployment bot token, not a per-connection token;
    - verification checks the one deployment webhook secret;
    - there is no per-connection webhook to register, so activation is a no-op.
    """

    channel = "telegram_hosted"

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return fetch_telegram_hosted_capabilities()

    def hosted_setup_available(self) -> bool:
        # Ready only when the deployment has both the bot token and the webhook
        # secret configured.
        return env.channels.telegram.enabled

    async def verify_connection(
        self,
        *,
        connection: ChannelConnectionCreate,
        credentials: Dict[str, Any],
    ) -> Dict[str, Any]:
        # Nothing to verify per connection: the hosted bot's token is a
        # deployment fact, checked once at deploy time, never pasted per
        # project. The connection's identity is the project, taken from the
        # request scope by create_connection. Return the deployment bot's id and
        # username so they land in the connection data (flat, not in the
        # identity key) for parse_event's bot-authored and mention checks.
        discovered: Dict[str, Any] = {}
        bot_id = self.deployment_bot_id()
        if bot_id is not None:
            discovered["bot_id"] = bot_id
        if env.channels.telegram.bot_username:
            discovered["bot_username"] = env.channels.telegram.bot_username
        return discovered

    async def activate_connection(
        self,
        *,
        connection: ChannelConnection,
        credentials: Dict[str, Any],
    ) -> None:
        # The hosted webhook is set once per deployment (ops), not per project.
        # Running setWebhook here would repoint the shared bot for everyone.
        return None

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        # The hosted path does not resolve a connection from the request alone:
        # the shared ingress resolves (bot_id, chat_id) -> project from the bind
        # map. This is never used on the hosted ingress flow.
        return None

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        # One deployment webhook secret for the shared bot, not a per-connection
        # one. Returns the connection's project, which the ownership check then
        # matches against the project-only locator.
        lowered = {k.lower(): v for k, v in request.headers.items()}
        secret = env.channels.telegram.webhook_secret
        if not secret:
            raise ChannelSignatureInvalid(channel=self.channel)
        verify_telegram_secret(
            headers=lowered, webhook_secret=secret, channel=self.channel
        )
        project = _connection_project(connection)
        if project is None:
            raise ChannelSignatureInvalid(channel=self.channel)
        return project

    async def _call(
        self, connection: ChannelConnection, method: str, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        # Egress for every hosted connection uses the one deployment token.
        token = env.channels.telegram.bot_token
        if not token:
            raise ChannelSignatureInvalid(channel=self.channel)
        return await self._call_with_token(token, method, params)

    @staticmethod
    def deployment_bot_id() -> Optional[str]:
        """The numeric id of the deployment bot, read from its token
        (`<bot_id>:<secret>`). This is the routing token in the hosted webhook
        path `/telegram/events/<bot_id>/`."""

        token = env.channels.telegram.bot_token
        if not token or ":" not in token:
            return None
        return token.split(":", 1)[0]
