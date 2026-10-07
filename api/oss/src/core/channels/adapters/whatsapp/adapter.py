import asyncio
from typing import Any
from uuid import UUID

import httpx

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.whatsapp import mapping
from oss.src.core.channels.adapters.whatsapp.capabilities import (
    fetch_whatsapp_capabilities,
)
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelInboundEvent,
    ChannelRequestContext,
    ChannelSpaceCandidate,
)
from oss.src.core.channels.types import (
    ChannelConnectionIncomplete,
    ChannelConnectionVerificationFailed,
    ChannelCredentialRevoked,
    ChannelDeliveryHeld,
    ChannelDeliveryUncertain,
    ChannelSignatureInvalid,
)
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# Meta error codes the adapter acts on.
_WINDOW_CLOSED = 131047  # more than 24 hours since the customer's last message
_PAIR_RATE_LIMIT = 131056  # too many messages to one customer too fast
_TOKEN_INVALID = 190
# Meta answers "try again later" with an HTTP 400. These codes are reported as
# a 429, so the outbox retries them like any rate limit instead of failing the
# reply: app (4), account (80007), throughput (130429), spam (131048) and pair
# (131056) rate limits, and a number under maintenance (131057, such as a
# throughput upgrade, which takes up to a minute).
_TRY_LATER = {4, 80007, 130429, 131048, _PAIR_RATE_LIMIT, 131057}

# Meta's answers to the connect probe's recipient "0" once authorization has
# passed: invalid parameter (131009, seen live), not in the test number's
# allowed list (131030), undeliverable (131026). Only these prove the token
# may send; anything else blocks the connect.
_RECIPIENT_REFUSED = {131009, 131030, 131026}

_PAIR_LIMIT_RETRIES = 2
_MEDIA_TIMEOUT_SECONDS = 30.0


def _data(connection: ChannelConnection | ChannelConnectionCreate) -> dict[str, Any]:
    return connection.data if isinstance(connection.data, dict) else {}


def _phone_number_id(connection: ChannelConnection | ChannelConnectionCreate) -> str:
    """The number, from a stored connection (under `connection_locator`) or
    from a create or rotate request (flat, as the operator typed it)."""

    data = _data(connection)
    locator = data.get("connection_locator")
    value = locator.get("phone_number_id") if isinstance(locator, dict) else None
    value = value or data.get("phone_number_id")
    if not value:
        raise ChannelConnectionIncomplete(channel="whatsapp", field="phone_number_id")
    return str(value)


def _access_token(connection: ChannelConnection) -> str:
    token = _data(connection).get("access_token")
    if not token:
        raise ChannelConnectionIncomplete(channel="whatsapp", field="access_token")
    return token


class WhatsAppAdapter(ChannelAdapterInterface):
    """One WhatsApp business phone number on Meta's Cloud API, brought by the
    customer: their phone number ID, a system-user token and their app secret.

    WhatsApp cannot edit a sent message, keeps a 24-hour reply window, and is
    one-to-one. The capability declaration tells core all three; this class
    only speaks the Graph API."""

    channel = "whatsapp"

    def __init__(
        self,
        *,
        http_client: httpx.AsyncClient | None = None,
        pair_limit_retry_seconds: float = 6.0,
    ) -> None:
        self._client = http_client or httpx.AsyncClient(
            base_url=env.channels.whatsapp.graph_api_url
        )
        self._pair_limit_retry_seconds = pair_limit_retry_seconds

    # --- declaration --- #

    async def fetch_capabilities(
        self, *, connection: ChannelConnection | None = None
    ) -> ChannelCapabilities:
        return fetch_whatsapp_capabilities()

    # --- setup --- #

    async def verify_connection(
        self,
        *,
        connection: ChannelConnectionCreate,
        credentials: dict[str, Any],
    ) -> dict[str, Any]:
        """Read the phone number with the token. A token that cannot read it
        stores nothing. Also returns what the operator pastes into Meta's
        webhook form: the callback URL and a fresh verify token. Rotation
        calls this too, with the stored data and only the new credential;
        the app secret cannot be checked against Meta, so it is not required
        here (the setup form requires it)."""

        phone_number_id = _phone_number_id(connection).strip()
        token = (credentials or {}).get("access_token")
        if not token:
            raise ChannelConnectionIncomplete(
                channel=self.channel, field="access_token"
            )

        try:
            number = await self._call(
                token,
                "GET",
                f"/{phone_number_id}",
                params={"fields": "display_phone_number,verified_name"},
            )
        except (_GraphApiError, ChannelCredentialRevoked) as e:
            raise ChannelConnectionVerificationFailed(
                channel=self.channel,
                message=f"Meta refused the token for this phone number: {e}",
            ) from e

        await self._check_can_send(token=token, phone_number_id=phone_number_id)

        base_url = (env.agenta.api_url or "").rstrip("/")
        discovered = {
            "phone_number_id": phone_number_id,
            "display_phone_number": number.get("display_phone_number"),
            "verified_name": number.get("verified_name"),
            "webhook_url": f"{base_url}/channels/whatsapp/events/",
            "webhook_verify_token": mapping.mint_verify_token(phone_number_id),
        }
        return {k: v for k, v in discovered.items() if v is not None}

    async def _check_can_send(self, *, token: str, phone_number_id: str) -> None:
        """Reading the number is not enough: a token whose system user has no
        WhatsApp account assigned reads it fine and fails every send. So probe
        a send to "0", which is no WhatsApp number and cannot be delivered.
        Meta checks authorization first: a complaint about the recipient means
        the token can send; "Authorization Error" (or a permission code)
        means it cannot; any other answer is inconclusive and blocks."""

        try:
            await self._call(
                token,
                "POST",
                f"/{phone_number_id}/messages",
                json={
                    "messaging_product": "whatsapp",
                    "to": "0",
                    "type": "text",
                    "text": {"body": "."},
                },
            )
        except ChannelCredentialRevoked as e:
            raise ChannelConnectionVerificationFailed(
                channel=self.channel,
                message=f"Meta refused the token for this phone number: {e}",
            ) from e
        except httpx.HTTPError as e:
            raise ChannelConnectionVerificationFailed(
                channel=self.channel,
                message=(
                    "Could not confirm with Meta that this token can send from "
                    f"this number. Try again. ({type(e).__name__})"
                ),
            ) from e
        except _GraphApiError as e:
            if e.code in _RECIPIENT_REFUSED:
                return  # the recipient was refused, after authorization passed
            if not e.denied:
                raise ChannelConnectionVerificationFailed(
                    channel=self.channel,
                    message=(
                        "Could not confirm with Meta that this token can send "
                        f"from this number. Try again. ({e})"
                    ),
                ) from e
            raise ChannelConnectionVerificationFailed(
                channel=self.channel,
                message=(
                    "This token can't send messages from this number. In Meta "
                    "Business Settings → System users → <user>, assign the "
                    f"WhatsApp account with Full control. ({e})"
                ),
            ) from e

    async def revoke_installation(self, *, connection: ChannelConnection) -> str | None:
        # The webhook lives on the customer's own Meta app, which may serve
        # other tools too, so Agenta does not unsubscribe it. Archiving stops
        # routing here; the notice tells the operator where to finish.
        return (
            "Disconnected. Agenta no longer answers this number. To stop Meta "
            "sending its messages here, remove the callback URL in your Meta "
            "app's WhatsApp configuration."
        )

    # --- ingress --- #

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> dict[str, Any] | None:
        ids = mapping.phone_number_ids(request.body)
        return {"phone_number_id": ids[0]} if ids else None

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        lowered = {k.lower(): v for k, v in request.headers.items()}
        app_secret = _data(connection).get("app_secret")
        if not app_secret:
            raise ChannelSignatureInvalid(channel=self.channel)
        mapping.verify_signature(
            headers=lowered, body=request.body, app_secret=app_secret
        )
        return _phone_number_id(connection)

    async def parse_event(
        self, *, body: bytes, connection: ChannelConnection | None = None
    ) -> list[ChannelInboundEvent]:
        """Every customer message this body carries for the connection's own
        number. One webhook can batch several."""

        if connection is None:
            return []
        for status in mapping.failed_statuses(body):
            log.warning(
                "[CHANNELS] whatsapp delivery failed message=%s code=%s: %s",
                status["message_id"],
                status["code"],
                status["title"],
            )
        return mapping.parse_events(
            body=body, phone_number_id=_phone_number_id(connection)
        )

    # --- egress --- #

    async def post_message(
        self,
        *,
        connection: ChannelConnection,
        locator: dict[str, Any],
        content: list[dict[str, Any]],
        idempotency_key: UUID,
    ) -> dict[str, Any]:
        wa_id = locator["wa_id"]
        receipt: dict[str, Any] = {}
        for message in mapping.build_messages(content=content, wa_id=wa_id):
            try:
                message_id = await self._send(connection, message)
            except Exception as exc:
                if receipt:
                    # An earlier part is already in the chat; a retry would
                    # send it twice.
                    raise ChannelDeliveryUncertain(
                        channel=self.channel, detail=str(exc)[:200]
                    ) from exc
                raise
            receipt = {"wa_id": wa_id, "message_id": message_id}
        return receipt

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: dict[str, Any],
        content: list[dict[str, Any]],
        idempotency_key: UUID,
    ) -> dict[str, Any]:
        # The declaration says controls.update is false, so core never asks.
        raise NotImplementedError("WhatsApp cannot edit a sent message.")

    async def signal_activity(
        self, *, connection: ChannelConnection, locator: dict[str, Any]
    ) -> None:
        """Mark the customer's message read and show "typing…". Meta ties the
        indicator to an inbound message id, which core passes as
        `inbound_message_id`. A refusal raises; the outbox, which calls this,
        treats it as best-effort and stops signaling on a lasting refusal."""

        message_id = locator.get("inbound_message_id")
        if not message_id:
            return
        await self._call(
            _access_token(connection),
            "POST",
            f"/{_phone_number_id(connection)}/messages",
            json={
                "messaging_product": "whatsapp",
                "status": "read",
                "message_id": message_id,
                "typing_indicator": {"type": "text"},
            },
        )

    async def reopen_conversation(
        self, *, connection: ChannelConnection, locator: dict[str, Any]
    ) -> bool:
        """Send the connection's re-open template, if the operator chose one.
        False when none is configured: the reply stays held and nothing goes
        out."""

        data = _data(connection)
        name = (data.get("reopen_template") or "").strip()
        if not name:
            return False
        language = (data.get("reopen_template_language") or "").strip() or "en_US"
        await self._send(
            connection,
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": locator["wa_id"],
                "type": "template",
                "template": {"name": name, "language": {"code": language}},
            },
        )
        return True

    async def fetch_media(
        self,
        *,
        connection: ChannelConnection,
        media: dict[str, Any],
        max_bytes: int | None = None,
    ) -> tuple[bytes, str | None] | None:
        """Download an inbound image or document. Two calls: the media id
        resolves to a short-lived URL, which is fetched with the same token.
        None when Meta reports it larger than `max_bytes`."""

        token = _access_token(connection)
        meta = await self._call(token, "GET", f"/{media['media_id']}")
        size = meta.get("file_size")
        if max_bytes is not None and isinstance(size, int) and size > max_bytes:
            return None
        response = await self._client.get(
            meta["url"],
            headers={"Authorization": f"Bearer {token}"},
            timeout=_MEDIA_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        if max_bytes is not None and len(response.content) > max_bytes:
            return None
        return response.content, meta.get("mime_type") or media.get("mime_type")

    # --- discovery and history --- #

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> list[ChannelSpaceCandidate]:
        # No API lists a number's chats. Spaces self-register on first message.
        return []

    async def fetch_history(
        self, *, connection: ChannelConnection, locator: dict[str, Any], limit: int
    ) -> list[ChannelInboundEvent]:
        raise NotImplementedError("WhatsApp has no history API; backfill is off.")

    # --- internals --- #

    async def _send(
        self, connection: ChannelConnection, message: dict[str, Any]
    ) -> str:
        """POST one message; the new message id. Retries the pair rate limit
        only, which Meta answers before accepting anything."""

        path = f"/{_phone_number_id(connection)}/messages"
        token = _access_token(connection)
        for attempt in range(_PAIR_LIMIT_RETRIES + 1):
            try:
                body = await self._call(token, "POST", path, json=message)
            except _GraphApiError as e:
                if e.code == _PAIR_RATE_LIMIT and attempt < _PAIR_LIMIT_RETRIES:
                    await asyncio.sleep(self._pair_limit_retry_seconds)
                    continue
                if e.code == _WINDOW_CLOSED:
                    raise ChannelDeliveryHeld(channel=self.channel) from e
                raise
            return ((body.get("messages") or [{}])[0]).get("id")
        raise AssertionError("unreachable")  # pragma: no cover

    async def _call(
        self,
        token: str,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = await self._client.request(
            method,
            path,
            params=params,
            json=json,
            headers={"Authorization": f"Bearer {token}"},
        )
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code < 400 and "error" not in body:
            return body
        error = body.get("error") if isinstance(body, dict) else None
        error = error if isinstance(error, dict) else {}
        code = error.get("code")
        if code == _TOKEN_INVALID or response.status_code == 401:
            # The system-user token was revoked or expired. No retry passes.
            raise ChannelCredentialRevoked(
                channel="whatsapp",
                detail=_describe(error).replace(token, "[REDACTED]"),
            )
        raise _GraphApiError(
            error=error,
            status_code=429 if code in _TRY_LATER else response.status_code,
            token=token,
        )


def _describe(error: dict[str, Any]) -> str:
    """Meta's whole error, for the log and the outbox row: the code, subcode
    and type, the message, `error_data.details` (usually the actual cause)
    and the trace id Meta support asks for."""

    head = f"Graph API error {error.get('code')}"
    if error.get("error_subcode") is not None:
        head += f"/{error['error_subcode']}"
    if error.get("type"):
        head += f" ({error['type']})"
    text = f"{head}: {error.get('message') or 'unknown error'}"
    details = (error.get("error_data") or {}).get("details")
    if details:
        text += f" Details: {details}"
    if error.get("fbtrace_id"):
        text += f" [fbtrace_id {error['fbtrace_id']}]"
    return text


class _GraphApiError(Exception):
    """A request Meta refused. `status_code` is what the outbox classifies
    by: a 4xx other than a 429 is a refusal no retry changes."""

    def __init__(self, *, error: dict[str, Any], status_code: int, token: str):
        self.code = error.get("code")
        self.status_code = status_code
        # Meta refused the caller, not the request: a permission code, or
        # code 100 "Authorization Error", which it sends before it reads the
        # rest of the request when the token's user has no access to the
        # number's WhatsApp account.
        self.denied = self.code in (10, 200) or (
            self.code == 100
            and str(error.get("message") or "").strip() == "Authorization Error"
        )
        # Never the token, even where Meta echoes a request back.
        super().__init__(
            _describe(error).replace(token, "[REDACTED]") if token else _describe(error)
        )
