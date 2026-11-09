import asyncio
import time
from typing import Any, Dict, List, Literal, Optional, Set, Tuple
from urllib.parse import quote
from uuid import UUID

import httpx

from oss.src.core.channels.adapters.discord import mapping
from oss.src.core.channels.adapters.discord.capabilities import (
    fetch_discord_capabilities,
)
from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelInboundEvent,
    ChannelRequestContext,
    ChannelSetupDoc,
    ChannelSetupIdentity,
    ChannelSpaceCandidate,
)
from oss.src.core.channels.types import (
    ChannelConnectionIncomplete,
    ChannelConnectionVerificationFailed,
    ChannelCredentialRevoked,
    ChannelDeliveryUncertain,
    ChannelsError,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_DISCORD_API_BASE = "https://discord.com/api/v10"

_UNKNOWN_CHANNEL = 10003
_UNKNOWN_MESSAGE = 10008
_THREAD_ALREADY_CREATED = 160004

_DEFERRED_UPDATE_MESSAGE = 6
_HISTORY_PAGE_MAX = 100
# A channel's type and parent never change, and a renamed channel only names a
# space created later, so entries never need refreshing; the cap only bounds
# memory.
_CACHE_MAX = 1024

# Removing the bot and inviting it again can give it a new managed role.
_BOT_ROLE_TTL_SECONDS = 600.0

_RECEIVED_EMOJI = quote("👀")
_COMPLETED_EMOJI = quote("✅")


def _data(connection: ChannelConnection) -> Dict[str, Any]:
    return connection.data if isinstance(connection.data, dict) else {}


def _bot_token(connection: ChannelConnection) -> str:
    token = _data(connection).get("bot_token")
    if not token:
        raise ChannelConnectionIncomplete(channel="discord", field="bot_token")
    return token


def _bot_user_id(connection: ChannelConnection) -> Optional[str]:
    value = _data(connection).get("bot_user_id")
    return str(value) if value else None


class DiscordAdapter(ChannelAdapterInterface):
    """A Discord bot the user creates and pastes the token of.

    Messages and button clicks arrive over the Discord Gateway socket, which
    the socket loop in worker-queues holds and feeds to `parse_event` as the
    dispatch's JSON (`{"t": <event name>, "d": <event data>}`). Every outbound
    call is REST."""

    channel = "discord"

    def __init__(self, *, http_client: Optional[httpx.AsyncClient] = None) -> None:
        self._client = http_client or httpx.AsyncClient(base_url=_DISCORD_API_BASE)
        # (connection id, channel id) -> the channel object
        self._channels: Dict[Tuple[UUID, str], Dict[str, Any]] = {}
        # (connection id, thread id) of threads known to exist
        self._threads: Set[Tuple[UUID, str]] = set()
        # (connection id, guild id) -> (read at, the bot's managed role or None)
        self._bot_roles: Dict[Tuple[UUID, str], Tuple[float, Optional[str]]] = {}

    # --- declaration --- #

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return fetch_discord_capabilities()

    # --- setup --- #

    async def verify_connection(
        self,
        *,
        connection: ChannelConnectionCreate,
        credentials: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Read the application with the bot token, and refuse it unless the
        Message Content intent is on: without it every message in a server
        arrives empty. Read-only, so it runs before any row is written."""

        token = (credentials or {}).get("bot_token")
        if not token:
            raise ChannelConnectionIncomplete(channel=self.channel, field="bot_token")

        try:
            application = await self._request(token, "GET", "/applications/@me")
        except ChannelCredentialRevoked as e:
            raise ChannelConnectionVerificationFailed(
                channel=self.channel, message="Discord rejected this bot token."
            ) from e
        except (_DiscordApiError, httpx.HTTPError) as e:
            raise ChannelConnectionVerificationFailed(
                channel=self.channel,
                message="Could not check this bot token with Discord. Try again.",
            ) from e

        if not mapping.message_content_enabled(application.get("flags")):
            raise ChannelConnectionVerificationFailed(
                channel=self.channel,
                message=(
                    "Turn on the Message Content intent for this bot in the "
                    "Discord Developer Portal, then try again."
                ),
            )

        bot = application.get("bot") or {}
        discovered = {
            "application_id": str(application["id"]),
            "bot_user_id": str(bot["id"]) if bot.get("id") else None,
            "bot_username": bot.get("username"),
            "application_name": application.get("name"),
        }
        return {k: v for k, v in discovered.items() if v is not None}

    async def build_setup_document(
        self,
        *,
        request_url: str,
        identity: Optional[ChannelSetupIdentity] = None,
        locator: Optional[Dict[str, Any]] = None,
    ) -> Optional[ChannelSetupDoc]:
        application_id = (locator or {}).get("application_id")
        if not application_id:
            return None
        url = mapping.invite_url(str(application_id))
        return ChannelSetupDoc(format="text", content=url, link=url)

    # --- ingress --- #

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        # No HTTP route: events come over the socket, which knows its
        # connection.
        return None

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        raise NotImplementedError("Discord events arrive over the socket, unsigned.")

    async def parse_event(
        self,
        *,
        body: bytes,
        connection: Optional[ChannelConnection] = None,
        request: Optional[ChannelRequestContext] = None,
    ) -> Optional[ChannelInboundEvent]:
        payload = mapping.parse_body(body)
        data = payload.get("d")
        if connection is None or not isinstance(data, dict):
            return None

        if payload.get("t") == "INTERACTION_CREATE":
            event = mapping.parse_interaction(data)
            if event is not None:
                # Discord shows the click as failed unless it is answered
                # within 3 seconds.
                await self._acknowledge(data)
            return event

        if payload.get("t") != "MESSAGE_CREATE":
            return None

        bot_user_id = _bot_user_id(connection)
        # Also checked in parse_message; checked first here so the bot's own
        # replies cost no channel read.
        if not mapping.is_person_message(data) or mapping.is_bot_authored(
            data, bot_user_id=bot_user_id
        ):
            return None

        guild_id = data.get("guild_id")
        parent_id = title = None
        if guild_id:
            # `MESSAGE_CREATE` names neither the channel nor a thread's parent.
            channel = await self._channel(connection, str(data["channel_id"]))
            if mapping.is_thread_channel(channel.get("type")) and channel.get(
                "parent_id"
            ):
                parent_id = str(channel["parent_id"])
                channel = await self._channel(connection, parent_id)
            title = channel.get("name")
        # The roles are read only when a role mention is the bot's only way
        # to be addressed, so a failed read never drops a direct mention.
        bot_role_id = (
            await self._bot_role(connection, str(guild_id))
            if guild_id
            and data.get("mention_roles")
            and not mapping.mentions_bot(data, bot_user_id=bot_user_id)
            else None
        )

        return mapping.parse_message(
            data,
            guild_id=guild_id,
            parent_id=parent_id,
            title=title,
            bot_role_id=bot_role_id,
            bot_user_id=bot_user_id,
            bot_username=_data(connection).get("bot_username"),
        )

    async def _channel(
        self, connection: ChannelConnection, channel_id: str
    ) -> Dict[str, Any]:
        key = (connection.id, channel_id)
        if key not in self._channels:
            if len(self._channels) >= _CACHE_MAX:
                self._channels.clear()
            self._channels[key] = await self._request(
                _bot_token(connection), "GET", f"/channels/{channel_id}"
            )
        return self._channels[key]

    async def _bot_role(
        self, connection: ChannelConnection, guild_id: str
    ) -> Optional[str]:
        """The role Discord made for the bot in this server: the one whose
        `tags.bot_id` is the bot. `MESSAGE_CREATE` gives only role ids."""

        key = (connection.id, guild_id)
        now = time.monotonic()
        cached = self._bot_roles.get(key)
        if cached is None or now - cached[0] > _BOT_ROLE_TTL_SECONDS:
            roles = await self._request(
                _bot_token(connection), "GET", f"/guilds/{guild_id}/roles"
            )
            bot_user_id = _bot_user_id(connection)
            role_id = next(
                (
                    str(role["id"])
                    for role in (roles if isinstance(roles, list) else [])
                    if isinstance(role, dict)
                    and bot_user_id
                    and str((role.get("tags") or {}).get("bot_id")) == bot_user_id
                ),
                None,
            )
            if len(self._bot_roles) >= _CACHE_MAX:
                self._bot_roles.clear()
            self._bot_roles[key] = (now, role_id)
        return self._bot_roles[key][1]

    async def _acknowledge(self, interaction: Dict[str, Any]) -> None:
        """Answer the click with a deferred update: nothing changes on the
        message yet. Best-effort: a failure never blocks routing the click."""

        try:
            response = await self._client.post(
                f"/interactions/{interaction['id']}/{interaction['token']}/callback",
                json={"type": _DEFERRED_UPDATE_MESSAGE},
            )
            if response.is_error:
                log.warning(
                    "[DISCORD] click acknowledgement refused: %s",
                    response.status_code,
                )
        except (KeyError, httpx.HTTPError) as exc:
            log.warning(
                "[DISCORD] click acknowledgement failed: %s", type(exc).__name__
            )

    # --- egress --- #

    async def post_message(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        target = mapping.reply_channel_id(locator)
        bodies = mapping.build_messages(content)
        if not bodies:
            return {}
        if self._thread_missing(connection, locator):
            await self._start_thread(connection, locator)
        token = _bot_token(connection)
        receipt: Dict[str, Any] = {}
        for body in bodies:
            try:
                message = await self._request(
                    token, "POST", f"/channels/{target}/messages", json=body
                )
            except Exception as exc:
                if receipt:
                    # An earlier part is already in the channel; a retry
                    # would post it twice.
                    raise ChannelDeliveryUncertain(
                        channel=self.channel, detail=str(exc)[:200]
                    ) from exc
                raise
            receipt = {"source_channel_id": target, "message_id": str(message["id"])}
        return receipt

    def _thread_missing(
        self, connection: ChannelConnection, locator: Dict[str, Any]
    ) -> bool:
        """True while the thread a reply goes into may not exist yet. The
        locator alone cannot tell: a thread's stored locator keeps naming the
        message it starts from."""

        return mapping.opens_thread(locator) and (
            (connection.id, locator["thread_id"]) not in self._threads
        )

    async def _start_thread(
        self, connection: ChannelConnection, locator: Dict[str, Any]
    ) -> None:
        """Start the thread from the message the reply answers. Discord
        refuses a second start, which means the thread exists. It answers
        Unknown Message once the starter message is deleted, which leaves the
        thread in place; if the thread is gone too, the post is refused."""

        try:
            await self._request(
                _bot_token(connection),
                "POST",
                f"/channels/{locator['source_channel_id']}/messages/"
                f"{locator['message_id']}/threads",
                json={
                    "name": locator.get("thread_name") or locator["message_id"],
                },
            )
        except _DiscordApiError as e:
            if e.status_code >= 500:
                raise _ThreadNotStarted(detail=str(e)) from e
            if e.code not in (_THREAD_ALREADY_CREATED, _UNKNOWN_MESSAGE):
                raise
        except httpx.HTTPError as e:
            raise _ThreadNotStarted(detail=type(e).__name__) from e
        self._remember_thread(connection, locator["thread_id"])

    def _remember_thread(self, connection: ChannelConnection, thread_id: str) -> None:
        if len(self._threads) >= _CACHE_MAX:
            self._threads.clear()
        self._threads.add((connection.id, thread_id))

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        # The declaration says controls.update is false, so core never asks.
        raise NotImplementedError("Discord answers are posted, never edited.")

    async def dismiss_choices(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        channel_id = external_locator.get("source_channel_id")
        message_id = external_locator.get("message_id")
        if not channel_id or not message_id:
            return
        await self._request(
            _bot_token(connection),
            "PATCH",
            f"/channels/{channel_id}/messages/{message_id}",
            json={"components": []},
        )

    async def signal_activity(
        self, *, connection: ChannelConnection, locator: Dict[str, Any]
    ) -> None:
        """The typing indicator in the reply channel. Until the first reply
        starts the thread, it shows in the channel the message was posted
        in."""

        token = _bot_token(connection)
        target = mapping.reply_channel_id(locator)
        try:
            await self._request(token, "POST", f"/channels/{target}/typing")
        except _DiscordApiError as e:
            if e.code != _UNKNOWN_CHANNEL or not self._thread_missing(
                connection, locator
            ):
                raise
            await self._request(
                token, "POST", f"/channels/{locator['source_channel_id']}/typing"
            )
            return
        if mapping.opens_thread(locator):
            self._remember_thread(connection, target)

    async def set_message_status(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        status: Literal["received", "completed", "failed"],
    ) -> None:
        channel_id = locator.get("source_channel_id")
        message_id = locator.get("message_id")
        if not channel_id or not message_id:
            return
        operations = {
            "received": [("PUT", _RECEIVED_EMOJI)],
            "completed": [("PUT", _COMPLETED_EMOJI), ("DELETE", _RECEIVED_EMOJI)],
            "failed": [("DELETE", _RECEIVED_EMOJI)],
        }
        for method, emoji in operations[status]:
            try:
                await asyncio.wait_for(
                    self._request(
                        _bot_token(connection),
                        method,
                        f"/channels/{channel_id}/messages/{message_id}"
                        f"/reactions/{emoji}/@me",
                    ),
                    timeout=1.0,
                )
            except Exception as exc:  # noqa: BLE001 - a reaction is best-effort
                log.warning(
                    "[DISCORD] reaction %s failed: %s", method, type(exc).__name__
                )

    # --- discovery and history --- #

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        # Spaces self-register on the first message.
        return []

    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        messages = await self._request(
            _bot_token(connection),
            "GET",
            f"/channels/{locator['channel_id']}/messages",
            params={
                "limit": max(1, min(limit or _HISTORY_PAGE_MAX, _HISTORY_PAGE_MAX))
            },
        )
        events: List[ChannelInboundEvent] = []
        # Discord answers newest first; the inbox keeps context in insert order.
        for message in reversed(messages) if isinstance(messages, list) else []:
            event = mapping.parse_message(
                message,
                guild_id=locator.get("guild_id"),
                parent_id=None,
                bot_user_id=_bot_user_id(connection),
                bot_username=_data(connection).get("bot_username"),
            )
            if event is not None:
                events.append(event)
        return events

    async def fetch_messages_after(
        self, *, connection: ChannelConnection, channel_id: str, after: str
    ) -> List[Dict[str, Any]]:
        """One page of the messages after `after` in one channel, oldest first,
        as raw message objects. The socket loop's recovery pages forward with
        it and feeds each one to `parse_event`, so it is parsed like a live
        message."""

        messages = await self._request(
            _bot_token(connection),
            "GET",
            f"/channels/{channel_id}/messages",
            params={"after": after, "limit": _HISTORY_PAGE_MAX},
        )
        if not isinstance(messages, list):
            return []
        # Discord answers newest first.
        return sorted(messages, key=lambda message: int(message["id"]))

    # --- internals --- #

    async def _request(
        self,
        token: str,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
    ) -> Any:
        response = await self._client.request(
            method,
            path,
            params=params,
            json=json,
            headers={"Authorization": f"Bot {token}"},
        )
        try:
            body = response.json() if response.content else {}
        except ValueError:
            body = {}
        if response.status_code < 400:
            return body
        error = body if isinstance(body, dict) else {}
        if response.status_code == 401:
            # The bot token was reset or revoked. No retry can pass.
            raise ChannelCredentialRevoked(
                channel="discord", detail=str(error.get("message") or "")
            )
        raise _DiscordApiError(error=error, status_code=response.status_code)


class _DiscordApiError(Exception):
    """A request Discord refused. `status_code` is what the outbox classifies
    by: a 4xx other than a 429 is a refusal no retry changes."""

    def __init__(self, *, error: Dict[str, Any], status_code: int):
        self.code = error.get("code")
        self.status_code = status_code
        super().__init__(
            f"Discord API error {self.code} ({status_code}): "
            f"{error.get('message') or 'unknown error'}"
        )


class _ThreadNotStarted(ChannelsError):
    """Starting the reply thread failed with no answer from Discord, or a 5xx.
    No message was posted, so the outbox retries the delivery."""

    def __init__(self, *, detail: str):
        super().__init__(f"discord: the reply thread was not started ({detail})")
