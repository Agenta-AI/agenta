import json
import os
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs
from uuid import UUID

import httpx

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.slack.capabilities import fetch_slack_capabilities
from oss.src.core.channels.adapters.slack.mapping import (
    BUTTONS_MAX,
    MAX_CHARS,
    build_locator,
    classify_space_kind,
    extract_sigils,
    is_bot_authored,
    render_buttons_or_degrade,
    split_for_max_chars,
)
from oss.src.core.channels.adapters.slack.signature import verify_slack_signature
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelEventKind,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelRequestContext,
    ChannelSpaceCandidate,
    ChannelSpaceKind,
)
from oss.src.core.channels.types import (
    ChannelConnectionIncomplete,
    ChannelSignatureInvalid,
)

_SLACK_API_BASE = "https://slack.com/api"

# Default page size for backfill; clamped further to the install's own rate
# tier at fetch time.
_DEFAULT_BACKFILL_LIMIT = int(os.getenv("AGENTA_CHANNELS_BACKFILL_LIMIT") or 50)


class ChannelBackfillRefused(Exception):
    """Raised when the install's channels:history grant is denied (403),
    distinguishable from a legitimately empty page."""

    def __init__(self, *, reason: str = "channels:history denied"):
        self.reason = reason
        super().__init__(reason)


def _signing_secret(connection: ChannelConnection) -> str:
    data = connection.data if isinstance(connection.data, dict) else {}
    secret = data.get("signing_secret")
    if not secret:
        raise ChannelSignatureInvalid(channel="slack")
    return secret


def _bot_token(connection: ChannelConnection) -> str:
    data = connection.data if isinstance(connection.data, dict) else {}
    token = data.get("bot_token")
    if not token:
        raise ChannelConnectionIncomplete(channel="slack", field="bot_token")
    return token


def _bot_user_id(connection: ChannelConnection) -> Optional[str]:
    data = connection.data if isinstance(connection.data, dict) else {}
    return data.get("bot_user_id")


class SlackAdapter(ChannelAdapterInterface):
    """ChannelAdapterInterface for Slack."""

    channel = "slack"

    def __init__(self, *, http_client: Optional[httpx.AsyncClient] = None) -> None:
        self._client = http_client or httpx.AsyncClient(base_url=_SLACK_API_BASE)

    # --- declaration --- #

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return fetch_slack_capabilities()

    # --- ingress --- #

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        payload = _parse_slack_payload(request.body)
        team = payload.get("team")
        team_id = payload.get("team_id") or (
            team.get("id") if isinstance(team, dict) else None
        )
        return {"team_id": team_id} if team_id else None

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        lowered = {k.lower(): v for k, v in request.headers.items()}
        verify_slack_signature(
            headers=lowered,
            body=request.body,
            signing_secret=_signing_secret(connection),
            channel=self.channel,
        )

        locator = self.connection_locator(request=request)
        team_id = locator.get("team_id") if locator else None
        if not team_id:
            raise ChannelSignatureInvalid(channel=self.channel)

        return team_id

    async def parse_event(
        self, *, body: bytes, connection: Optional[ChannelConnection] = None
    ) -> Optional[ChannelInboundEvent]:
        payload = _parse_json(body)

        # URL verification handshake and non-event-callback payloads carry no
        # message to act on.
        if payload.get("type") != "event_callback":
            return None

        event = payload.get("event") or {}
        team_id = payload.get("team_id") or ""
        channel_id = event.get("channel") or ""

        bot_user_id = _bot_user_id(connection) if connection else None
        if is_bot_authored(event, bot_user_id=bot_user_id):
            return None

        text = event.get("text") or ""
        agent, command, _arg = extract_sigils(text)
        thread_ts = event.get("thread_ts")
        event_ts = event.get("ts") or ""

        locator = build_locator(team=team_id, channel=channel_id, thread_ts=thread_ts)

        content: List[Dict[str, Any]] = [{"type": "text", "text": text}]

        return ChannelInboundEvent(
            external_id=event.get("client_msg_id") or f"{channel_id}:{event_ts}",
            kind=ChannelEventKind.MESSAGE,
            space_kind=classify_space_kind(event),
            external_locator=locator,
            processed=ChannelInboxEventProcessed(
                content=content,
                sender={"id": event.get("user") or ""},
            ),
            addressed=bool(agent or command or event.get("type") == "app_mention"),
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
        text, blocks = _render_content(content)
        receipts = []
        for chunk in split_for_max_chars(text, max_chars=MAX_CHARS) or [""]:
            response = await self._call(
                connection,
                "chat.postMessage",
                {
                    "channel": locator["channel"],
                    "thread_ts": locator.get("thread_ts"),
                    "text": chunk,
                    "blocks": blocks if chunk == text else None,
                },
            )
            receipts.append({"channel": response["channel"], "ts": response["ts"]})
        # The last chunk's receipt is what edit_message targets.
        return receipts[-1]

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        text, blocks = _render_content(content)
        response = await self._call(
            connection,
            "chat.update",
            {
                "channel": external_locator["channel"],
                "ts": external_locator["ts"],
                "text": text,
                "blocks": blocks,
            },
        )
        return {"channel": response["channel"], "ts": response["ts"]}

    # --- discovery --- #

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        candidates: List[ChannelSpaceCandidate] = []
        response = await self._call(connection, "conversations.list", {})
        for entry in response.get("channels", []):
            candidates.append(
                ChannelSpaceCandidate(
                    kind=_space_kind_from_listing(entry),
                    external_locator={
                        "team": _team_of(connection),
                        "channel": entry["id"],
                    },
                    display_name=entry.get("name"),
                )
            )
        return candidates

    # --- history --- #

    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        clamped = (
            min(limit, _DEFAULT_BACKFILL_LIMIT) if limit else _DEFAULT_BACKFILL_LIMIT
        )

        params: Dict[str, Any] = {"channel": locator["channel"], "limit": clamped}
        if locator.get("thread_ts"):
            method = "conversations.replies"
            params["ts"] = locator["thread_ts"]
        else:
            method = "conversations.history"

        try:
            response = await self._call(connection, method, params)
        except _SlackApiError as e:
            if e.error == "missing_scope" or e.status_code == 403:
                raise ChannelBackfillRefused(reason=e.error) from e
            raise

        events: List[ChannelInboundEvent] = []
        for message in response.get("messages", []):
            # each message's own thread, not the one the request asked about:
            # a space read returns replies whose thread the request never named
            message_locator = build_locator(
                team=locator["team"],
                channel=locator["channel"],
                thread_ts=message.get("thread_ts") or locator.get("thread_ts"),
            )
            events.append(
                ChannelInboundEvent(
                    external_id=message.get("client_msg_id")
                    or f"{locator['channel']}:{message.get('ts')}",
                    kind=ChannelEventKind.MESSAGE,
                    space_kind=ChannelSpaceKind.TOPIC,
                    external_locator=message_locator,
                    processed=ChannelInboxEventProcessed(
                        content=[{"type": "text", "text": message.get("text") or ""}],
                        sender={"id": message.get("user") or ""},
                    ),
                )
            )
        return events

    # --- test seam (optional; mirrors contract suite's fake) --- #

    def inspect_posted(self, locator: Dict[str, Any]) -> List[Dict[str, Any]]:
        raise NotImplementedError(
            "SlackAdapter posts against the real Slack API; the contract "
            "suite's buttons-max assertion is a no-op here without this seam."
        )

    # --- internals --- #

    async def _call(
        self, connection: ChannelConnection, method: str, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        token = _bot_token(connection)
        response = await self._client.post(
            method,
            json={k: v for k, v in params.items() if v is not None},
            headers={"Authorization": f"Bearer {token}"},
        )
        body = response.json()
        if not body.get("ok"):
            raise _SlackApiError(
                error=body.get("error", "unknown_error"),
                status_code=response.status_code,
            )
        return body


class _SlackApiError(Exception):
    def __init__(self, *, error: str, status_code: int):
        self.error = error
        self.status_code = status_code
        super().__init__(f"Slack API error: {error}")


def _parse_json(body: bytes) -> Dict[str, Any]:
    try:
        return json.loads(body) if body else {}
    except ValueError:
        return {}


def _parse_slack_payload(body: bytes) -> Dict[str, Any]:
    """Events API and slash commands send JSON or flat form fields; block
    interactivity sends form-encoded body with the JSON under `payload` —
    without this fallback its nested `team.id` is unreachable."""

    parsed = _parse_json(body)
    if parsed:
        return parsed

    try:
        fields = parse_qs(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return {}

    payload_field = fields.get("payload")
    if not payload_field:
        return {}

    return _parse_json(payload_field[0].encode("utf-8"))


def _render_content(content: List[Dict[str, Any]]) -> tuple:
    """Flatten our internal content parts into (fallback text, Block Kit
    blocks). Buttons degrade to numbered text above BUTTONS_MAX."""

    buttons = [item for item in content if item.get("type") == "button"]
    texts = [item.get("text", "") for item in content if item.get("type") == "text"]

    text = "\n".join(t for t in texts if t)
    blocks: List[Dict[str, Any]] = []

    if texts:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": text}})

    if buttons:
        options = [
            {"label": b.get("label", b.get("id", "")), "value": b.get("id", "")}
            for b in buttons
        ]
        rendered = render_buttons_or_degrade(options, buttons_max=BUTTONS_MAX)
        if rendered["type"] == "buttons":
            blocks.append({"type": "actions", "elements": rendered["elements"]})
        else:
            text = f"{text}\n{rendered['text']}" if text else rendered["text"]
            blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": text}}]

    return text or " ", blocks


def _team_of(connection: ChannelConnection) -> str:
    data = connection.data if isinstance(connection.data, dict) else {}
    return data.get("team_id", "")


def _space_kind_from_listing(entry: Dict[str, Any]) -> ChannelSpaceKind:
    if entry.get("is_im"):
        return ChannelSpaceKind.PRIVATE
    if entry.get("is_mpim"):
        return ChannelSpaceKind.GROUP
    return ChannelSpaceKind.TOPIC
