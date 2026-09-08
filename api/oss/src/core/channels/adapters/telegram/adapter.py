from typing import Any, Dict, List, Optional
from uuid import UUID

import httpx

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.telegram.capabilities import (
    fetch_telegram_capabilities,
)
from oss.src.core.channels.adapters.telegram.mapping import (
    build_locator,
    classify_space_kind,
    is_addressed,
    is_bot_authored,
    render_content,
    routing_token_from_path,
    split_for_max_chars,
    MAX_CHARS,
)
from oss.src.core.channels.adapters.telegram.signature import verify_telegram_secret
from oss.src.core.channels.render.render import INDICATOR_TEXT
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelEventKind,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelRequestContext,
    ChannelSpaceCandidate,
)
from oss.src.core.channels.types import (
    ChannelConnectionIncomplete,
    ChannelConnectionVerificationFailed,
    ChannelSignatureInvalid,
)
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_TELEGRAM_API_BASE = "https://api.telegram.org"

# Telegram's own signal that the bot was removed from a chat: a my_chat_member
# update whose new status is one of these. Deactivate, never route as a message.
_DEACTIVATION_STATUSES = {"kicked", "left"}


def _bot_token(connection: ChannelConnection) -> str:
    data = connection.data if isinstance(connection.data, dict) else {}
    token = data.get("bot_token")
    if not token:
        raise ChannelConnectionIncomplete(channel="telegram", field="bot_token")
    return token


def _webhook_secret(connection: ChannelConnection) -> str:
    data = connection.data if isinstance(connection.data, dict) else {}
    secret = data.get("webhook_secret")
    if not secret:
        raise ChannelSignatureInvalid(channel="telegram")
    return secret


def _bot_id(connection: ChannelConnection) -> Optional[int]:
    data = connection.data if isinstance(connection.data, dict) else {}
    # bot_id is the connection identity key, so it is stored nested under
    # connection_locator; a flat value is the fallback (tests, hydration shapes).
    locator = data.get("connection_locator")
    value = None
    if isinstance(locator, dict):
        value = locator.get("bot_id")
    if value is None:
        value = data.get("bot_id")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _bot_username(connection: ChannelConnection) -> Optional[str]:
    data = connection.data if isinstance(connection.data, dict) else {}
    return data.get("bot_username")


class TelegramAdapter(ChannelAdapterInterface):
    """ChannelAdapterInterface for a Telegram bot (custom-bot path).

    The Agenta-owned hosted bot keys on the project and resolves the
    chat-to-project map at account-bind time; that path is added on top of
    this one. Everything here works for a customer's own bot token.
    """

    channel = "telegram"

    def __init__(self, *, http_client: Optional[httpx.AsyncClient] = None) -> None:
        self._client = http_client or httpx.AsyncClient(base_url=_TELEGRAM_API_BASE)

    # --- declaration --- #

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return fetch_telegram_capabilities()

    def hosted_setup_available(self) -> bool:
        # The Agenta-owned Telegram bot install is a separate slice.
        return False

    # --- setup --- #

    async def verify_connection(
        self,
        *,
        connection: ChannelConnectionCreate,
        credentials: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Prove the bot token works and return what getMe discovered — the
        bot id and username a human should not have to type. Read-only, so it
        runs before any row is written. Registering the webhook WRITES on
        Telegram's side, so it happens after the row is stored, in a separate
        activate step, not here."""

        bot_token = (credentials or {}).get("bot_token")
        if not bot_token:
            raise ChannelConnectionIncomplete(channel=self.channel, field="bot_token")

        body = await self._call_with_token(bot_token, "getMe", {})
        if not body.get("ok"):
            raise ChannelConnectionVerificationFailed(
                channel=self.channel,
                message=body.get("description", "unknown_error"),
            )

        result = body.get("result") or {}
        bot_id = result.get("id")
        discovered = {
            # Stored as a string on purpose: the identity key is a uuid5 over
            # the canonical JSON of this value, and the ingress reads the bot id
            # from the URL path as a string. An int here and a string there
            # would hash to two different keys and never resolve.
            "bot_id": str(bot_id) if bot_id is not None else None,
            "bot_username": result.get("username"),
            # Not part of the identity key; gives the connection a human name
            # when the caller sends none.
            "bot_name": result.get("first_name"),
        }
        return {k: v for k, v in discovered.items() if v is not None}

    async def activate_connection(
        self,
        *,
        connection: ChannelConnection,
        credentials: Dict[str, Any],
    ) -> None:
        """Point the bot at our per-bot ingress URL. Runs after the row is
        stored, because setWebhook WRITES on Telegram's side and the first
        update it triggers must find a row (and its secret) to verify against.

        The webhook URL carries the bot id as its routing token, and the
        secret token is the stored webhook secret Telegram echoes back on every
        update for verify_signature to check. The public API URL is a
        deployment fact read here, the way the Slack OAuth code reads its own
        settings."""

        bot_token = credentials.get("bot_token")
        webhook_secret = credentials.get("webhook_secret")
        bot_id = _bot_id(connection)
        if not bot_token or not webhook_secret or bot_id is None:
            raise ChannelConnectionIncomplete(
                channel=self.channel, field="bot_token/webhook_secret"
            )

        base_url = (env.agenta.api_url or "").rstrip("/")
        url = f"{base_url}/channels/telegram/events/{bot_id}/"
        await self._call_with_token(
            bot_token,
            "setWebhook",
            {
                "url": url,
                "secret_token": webhook_secret,
                "allowed_updates": ["message", "callback_query", "my_chat_member"],
                # A stale queue from a previous owner of this token is not this
                # connection's history; start clean.
                "drop_pending_updates": True,
            },
        )

    # --- ingress --- #

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        """A Telegram update never names its bot, so the connection is read
        from the per-bot ingress path, not the body. The token segment is the
        bot id for a custom bot."""

        token = routing_token_from_path(request.path)
        if not token:
            return None
        return {"bot_id": token}

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        lowered = {k.lower(): v for k, v in request.headers.items()}
        verify_telegram_secret(
            headers=lowered,
            webhook_secret=_webhook_secret(connection),
            channel=self.channel,
        )

        bot_id = _bot_id(connection)
        if bot_id is None:
            raise ChannelSignatureInvalid(channel=self.channel)
        return str(bot_id)

    async def detect_deactivation(self, *, body: bytes) -> bool:
        update = _parse_json(body)
        member = update.get("my_chat_member") or {}
        new_member = member.get("new_chat_member") or {}
        return new_member.get("status") in _DEACTIVATION_STATUSES

    async def parse_event(
        self, *, body: bytes, connection: Optional[ChannelConnection] = None
    ) -> Optional[ChannelInboundEvent]:
        update = _parse_json(body)

        callback = update.get("callback_query")
        if callback:
            return _parse_callback_query(callback)

        # A plain message or a caption-bearing message. Edits, joins, and every
        # other update kind carry nothing to route.
        message = update.get("message")
        if not isinstance(message, dict):
            return None

        bot_id = _bot_id(connection) if connection else None
        if is_bot_authored(message, bot_id=bot_id):
            return None

        text = message.get("text") or message.get("caption") or ""
        chat = message.get("chat") or {}
        chat_id = chat.get("id")
        if chat_id is None:
            return None

        space_kind = classify_space_kind(message)
        thread_id = message.get("message_thread_id")
        locator = build_locator(chat_id=chat_id, message_thread_id=thread_id)

        sender = message.get("from") or {}
        addressed = is_addressed(
            message,
            space_kind=space_kind,
            bot_id=bot_id,
            bot_username=_bot_username(connection) if connection else None,
        )

        return ChannelInboundEvent(
            external_id=f"{chat_id}:{message.get('message_id')}",
            kind=ChannelEventKind.MESSAGE,
            space_kind=space_kind,
            external_locator=locator,
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": text}],
                sender={"id": sender.get("id")},
            ),
            addressed=addressed,
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
        # The turn-start indicator becomes the native "typing…" action in the
        # chat header, the way other Telegram bots show it. We post no
        # placeholder message for it and return an empty receipt, so the outbox
        # then delivers the real answer as its own fresh message rather than
        # editing a "Thinking…" bubble. That is why the Telegram capability
        # declares controls.update = false.
        if _is_indicator(content):
            await self._send_typing(connection, locator)
            return {}

        text, reply_markup = render_content(content)
        receipts: List[Dict[str, Any]] = []
        chunks = split_for_max_chars(text, max_chars=MAX_CHARS) or [" "]
        for chunk in chunks:
            params: Dict[str, Any] = {
                "chat_id": locator["chat_id"],
                "text": chunk,
                "parse_mode": "HTML",
            }
            if locator.get("message_thread_id"):
                params["message_thread_id"] = locator["message_thread_id"]
            # The keyboard belongs on the last chunk, the one the answer ends on.
            if reply_markup and chunk is chunks[-1]:
                params["reply_markup"] = reply_markup
            result = await self._call(connection, "sendMessage", params)
            message = result.get("result") or {}
            receipts.append(
                {
                    "chat_id": (message.get("chat") or {}).get("id"),
                    "message_id": message.get("message_id"),
                }
            )
        return receipts[-1]

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        text, reply_markup = render_content(content)
        params: Dict[str, Any] = {
            "chat_id": external_locator["chat_id"],
            "message_id": external_locator["message_id"],
            "text": text,
            "parse_mode": "HTML",
        }
        if reply_markup:
            params["reply_markup"] = reply_markup
        result = await self._call(connection, "editMessageText", params)
        message = result.get("result")
        # editMessageText returns True (not a message) when nothing changed;
        # keep the locator we were given in that case.
        if isinstance(message, dict):
            return {
                "chat_id": (message.get("chat") or {}).get("id"),
                "message_id": message.get("message_id"),
            }
        return {
            "chat_id": external_locator["chat_id"],
            "message_id": external_locator["message_id"],
        }

    async def _send_typing(
        self, connection: ChannelConnection, locator: Dict[str, Any]
    ) -> None:
        """The native "typing…" chat action. Best-effort: a failure here never
        blocks the message it precedes."""

        params: Dict[str, Any] = {"chat_id": locator["chat_id"], "action": "typing"}
        if locator.get("message_thread_id"):
            params["message_thread_id"] = locator["message_thread_id"]
        try:
            await self._call(connection, "sendChatAction", params)
        except _TelegramApiError:
            pass

    async def answer_callback_query(
        self, *, connection: ChannelConnection, callback_query_id: str
    ) -> None:
        """Stop the client's loading spinner after a button press. Not part of
        the adapter interface yet; the ingress calls it eagerly on an ACTION.
        Best-effort: a failure never blocks routing the click."""

        try:
            await self._call(
                connection,
                "answerCallbackQuery",
                {"callback_query_id": callback_query_id},
            )
        except _TelegramApiError:
            pass

    # --- discovery --- #

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        # A Telegram bot cannot list the chats it belongs to, so there is no
        # pick-list. Spaces self-register on first message.
        return []

    # --- history --- #

    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        # The Bot API has no history read. Capabilities declare backfill
        # unsupported, so the dispatcher never calls this; the raise makes a
        # wrong call loud rather than silently empty.
        raise NotImplementedError(
            "Telegram has no bot-readable history; backfill is unsupported."
        )

    # --- internals --- #

    async def _call(
        self, connection: ChannelConnection, method: str, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        return await self._call_with_token(_bot_token(connection), method, params)

    async def _call_with_token(
        self, token: str, method: str, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        clean = {k: v for k, v in params.items() if v is not None}
        response = await self._client.post(f"/bot{token}/{method}", json=clean)
        try:
            body = response.json()
        except ValueError:
            raise _TelegramApiError(
                description="non-json response", status_code=response.status_code
            )
        if not body.get("ok"):
            raise _TelegramApiError(
                description=body.get("description", "unknown_error"),
                status_code=response.status_code,
            )
        return body


class _TelegramApiError(Exception):
    def __init__(self, *, description: str, status_code: int):
        self.description = description
        self.status_code = status_code
        super().__init__(f"Telegram API error: {description}")


def _is_indicator(content: List[Dict[str, Any]]) -> bool:
    """True when this content is the turn-start indicator, the single
    INDICATOR_TEXT part, and nothing else. Telegram shows that as a typing
    action instead of a message."""

    texts = [p.get("text", "") for p in content if p.get("type") == "text"]
    has_button = any(p.get("type") == "button" for p in content)
    return texts == [INDICATOR_TEXT] and not has_button


def _parse_json(body: bytes) -> Dict[str, Any]:
    import json

    try:
        return json.loads(body) if body else {}
    except ValueError:
        return {}


def _parse_callback_query(callback: Dict[str, Any]) -> Optional[ChannelInboundEvent]:
    """A button press. The token is the button's callback_data, the same value
    we set as the button; the locator points at the message the button sits on
    so the answer threads there."""

    token = callback.get("data")
    if not token:
        return None

    message = callback.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if chat_id is None:
        return None

    user = callback.get("from") or {}
    thread_id = message.get("message_thread_id")

    # external_id is the click's own identity, not the message's: Telegram can
    # redeliver, and every button on one message would otherwise dedupe to the
    # message id.
    external_id = f"cbq:{callback.get('id')}"

    return ChannelInboundEvent(
        external_id=external_id,
        kind=ChannelEventKind.ACTION,
        space_kind=classify_space_kind(message),
        external_locator=build_locator(chat_id=chat_id, message_thread_id=thread_id),
        processed=ChannelInboxEventProcessed(
            content=[{"type": "text", "text": token}],
            sender={"id": user.get("id")},
        ),
        addressed=True,
    )
