import asyncio
import json
from functools import wraps
from typing import TYPE_CHECKING, Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger

from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelEventAck,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelEventOrigin,
    ChannelKeyGrain,
    ChannelRequestContext,
)
from oss.src.core.channels.types import (
    ChannelLocatorIncomplete,
    ChannelNotSupported,
    ChannelSignatureInvalid,
)
from oss.src.core.channels.utils import compose_external_key
from oss.src.core.channels.adapters.telegram.signature import verify_telegram_secret
from oss.src.core.channels.telegram_binding import BindTokenError
from oss.src.utils.env import env

if TYPE_CHECKING:
    # Imported only for typing so this module never hard-depends on them.
    from oss.src.core.channels.service import ChannelsService
    from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
    from oss.src.core.channels.telegram_binding import TelegramBindingService

log = get_module_logger(__name__)

_ENQUEUE_TIMEOUT_SECONDS = 5.0


def handle_channel_adapter_exceptions():
    """Map adapter/registry failures to HTTP. Mirrors triggers'
    handle_adapter_exceptions: unregistered channel -> 404, bad signature ->
    401 with no diagnostic detail (ChannelSignatureInvalid carries none)."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except ChannelNotSupported as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=str(e),
                ) from e
            except ChannelSignatureInvalid:
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"status": "error"},
                )

        return wrapper

    return decorator


class ChannelsIngressRouter:
    """Public ingress: one literal route per in-process channel, plus the one
    shared bridge route. Verify, write one row, ack 202 -- nothing else."""

    def __init__(
        self,
        *,
        channels_service: "ChannelsService",
        adapter_registry: "ChannelAdapterRegistry",
        dispatch_task: Optional[Any] = None,
        telegram_binding_service: Optional["TelegramBindingService"] = None,
    ):
        self.channels_service = channels_service
        self.adapter_registry = adapter_registry
        self.dispatch_task = dispatch_task
        # Present only when the hosted (Agenta-owned) Telegram bot is configured
        # for this deployment. Absent means every telegram update takes the
        # custom-bot path.
        self.telegram_binding_service = telegram_binding_service

        self.router = APIRouter()

        # One literal route per in-process channel. Written out, not generated
        # -- a path parameter has no literal prefix to exempt.
        self.router.add_api_route(
            "/slack/events/",
            self.ingest_slack_event,
            methods=["POST"],
            operation_id="ingest_slack_event",
            response_model=ChannelEventAck,
            status_code=status.HTTP_202_ACCEPTED,
        )

        # Telegram carries no bot identity in the update body, so the bot rides
        # the path: one webhook URL per bot. The token segment is read by the
        # adapter's connection_locator from request.url.path; the path
        # parameter here only makes the route match.
        self.router.add_api_route(
            "/telegram/events/{routing_token}/",
            self.ingest_telegram_event,
            methods=["POST"],
            operation_id="ingest_telegram_event",
            response_model=ChannelEventAck,
            status_code=status.HTTP_202_ACCEPTED,
        )

        # Bridges share one route -- their channel key is unknown at build time.
        self.router.add_api_route(
            "/bridge/events/",
            self.ingest_bridge_event,
            methods=["POST"],
            operation_id="ingest_bridge_event",
            response_model=ChannelEventAck,
            status_code=status.HTTP_202_ACCEPTED,
        )

        self.router.add_api_route(
            "/agenta/events/",
            self.ingest_agenta_event,
            methods=["POST"],
            operation_id="ingest_agenta_event",
            response_model=ChannelEventAck,
            status_code=status.HTTP_202_ACCEPTED,
        )

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def ingest_slack_event(self, request: Request) -> Any:
        # Slack registers an events URL only after the endpoint echoes a
        # `url_verification` challenge. The handshake carries no workspace
        # locator, so no connection can be selected to signature-check it
        # against, and echoing grants nothing: the response is the caller's
        # own string. Anything else on this route stays signed. Starlette
        # caches the body, so `_ingest` reading it again costs nothing.
        challenge = _slack_url_verification_challenge(await request.body())
        if challenge is not None:
            return JSONResponse({"challenge": challenge})
        return await self._ingest(channel="slack", request=request)

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def ingest_agenta_event(self, request: Request) -> Any:
        return await self._ingest(channel="agenta", request=request)

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def ingest_telegram_event(self, request: Request, routing_token: str) -> Any:
        # The same webhook path shape serves both bots. When the routing token
        # is the deployment's hosted bot id and the hosted bot is configured,
        # this is the shared Agenta bot: it resolves the chat to a project from
        # the bind map instead of keying on the bot id. Every other token is a
        # customer's own bot and takes the custom path, where the adapter reads
        # the bot id from request.url.path.
        from oss.src.core.channels.adapters.telegram_hosted.adapter import (
            HostedTelegramAdapter,
        )

        if (
            self.telegram_binding_service is not None
            and env.channels.telegram.enabled
            and routing_token == HostedTelegramAdapter.deployment_bot_id()
        ):
            return await self._ingest_hosted(request=request, bot_id=routing_token)
        return await self._ingest(channel="telegram", request=request)

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def ingest_bridge_event(self, request: Request) -> Any:
        # Every bridge shares this literal channel key; the credential (not
        # this path) resolves which installation is calling, and the adapter
        # is responsible for refusing a payload whose claimed sender
        # disagrees with the credential that signed it.
        return await self._ingest(channel="bridge", request=request)

    async def _resolve_candidate(
        self,
        *,
        channel: str,
        capabilities,
        locator: Optional[Dict[str, Any]],
    ):
        """The connection an unverified installation claim points at, or None.

        Composes with the CHANNEL-level declaration (`connection` is never
        passed to `fetch_capabilities` here): which fields identify an
        installation cannot itself depend on which installation it is, and no
        connection is known yet at this point in the request anyway. A
        locator missing a declared field refuses rather than resolving
        against a partial key -- that would silently leak across
        installations, so it is treated identically to "no connection found".
        """

        if not locator:
            return None

        try:
            external_key = compose_external_key(
                capabilities, ChannelKeyGrain.CONNECTION, locator
            )
        except ChannelLocatorIncomplete:
            return None

        resolved = (
            await self.channels_service.get_project_and_connection_by_external_key(
                channel=channel,
                external_key=external_key,
            )
        )
        if resolved is None:
            return None

        project_id, connection_id = resolved
        connection = await self.channels_service.fetch_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            return None

        return project_id, connection_id, connection

    async def _ingest(self, *, channel: str, request: Request) -> ChannelEventAck:
        """The shared body. Both handlers are one line calling this with their
        channel; the split exists for the route table and the SDK."""

        body = await request.body()

        adapter = self.adapter_registry.get(channel)

        request_context = ChannelRequestContext(
            headers=dict(request.headers),
            path=request.url.path,
            body=body,
        )

        # connection=None: the channel-level declaration, since no connection
        # is known yet and the CONNECTION-grain fields cannot depend on one.
        capabilities = await adapter.fetch_capabilities(connection=None)

        # The signing secret lives on the connection, so the connection has to
        # be in hand before the signature can be checked. The request's own
        # locator selects which one to check against and grants nothing: a
        # wrong claim finds no connection, or one whose secret fails, and
        # both refuse identically below.
        candidate = await self._resolve_candidate(
            channel=channel,
            capabilities=capabilities,
            locator=adapter.connection_locator(request=request_context),
        )

        if candidate is None:
            # No secret to verify against, so this cannot be accepted -- and it
            # must refuse exactly as a bad signature does. Answering anything
            # distinguishable here would turn the route into an oracle for
            # which installations exist.
            raise ChannelSignatureInvalid(channel=channel)

        project_id, connection_id, connection = candidate

        # Raises ChannelSignatureInvalid on failure -- caught by the decorator,
        # which answers 401 with no verification detail.
        external_id = await adapter.verify_signature(
            request=request_context,
            connection=connection,
        )

        # The claim only chose the secret. Adapters that derive the id from the
        # body rather than from the connection can still return one that belongs
        # to a different install, so the verified id must match the connection
        # the secret came from -- checked against this connection's own
        # recorded data, never against the (already-used) unverified locator.
        if not _connection_owns_identity(connection, external_id):
            raise ChannelSignatureInvalid(channel=channel)

        # An installation-stopped signal (Slack's app_uninstalled /
        # tokens_revoked), not a message to route. Deactivate and stop --
        # never reaches parse_event, which has no MESSAGE/ACTION shape for it.
        if await adapter.detect_deactivation(body=body):
            await self.channels_service.deactivate_connection(
                project_id=project_id,
                connection_id=connection_id,
            )
            return ChannelEventAck(status="accepted")

        inbound = await adapter.parse_event(body=body, connection=connection)

        if inbound is None:
            # Platform noise (ack, bot echo) -- not an error, nothing to log.
            return ChannelEventAck(status="accepted")

        event = ChannelInboxEventCreate(
            connection_id=connection_id,
            external_id=inbound.external_id,
            kind=inbound.kind,
            origin=ChannelEventOrigin.PUSHED,
            data=ChannelInboxEventData(
                external_locator=inbound.external_locator,
                processed=inbound.processed,
                # The adapter's classification. Dropping it made every space a
                # `group`, so a kind-level grant ("allow in DMs") never matched.
                space_kind=inbound.space_kind,
                addressed=inbound.addressed,
            ),
        )

        # None means the platform redelivered -- the dedup contract, not an
        # error. Treated identically to a fresh row.
        await self.channels_service.record_inbox_event(
            project_id=project_id,
            event=event,
        )

        if self.dispatch_task is not None:
            try:
                await asyncio.wait_for(
                    self.dispatch_task.kiq(
                        project_id=str(project_id),
                        connection_id=str(connection_id),
                        channel=channel,
                        external_id=inbound.external_id,
                    ),
                    timeout=_ENQUEUE_TIMEOUT_SECONDS,
                )
            except Exception as e:
                log.error("Failed to enqueue channel inbox event: %s", e)
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Failed to enqueue channel inbox event",
                ) from e

        return ChannelEventAck(status="accepted")

    async def _ingest_hosted(self, *, request: Request, bot_id: str) -> ChannelEventAck:
        """The shared Agenta bot. One deployment secret authenticates every
        update; the chat-to-project bind map, not the bot id, says which project
        an update belongs to. A `/start <token>` completes the bind; any other
        update routes to the already-bound project, or is ignored if the chat is
        not bound yet."""

        body = await request.body()
        adapter = self.adapter_registry.get("telegram_hosted")

        # One deployment webhook secret, checked before anything is read or
        # written. A first /start arrives with no connection to key on, so the
        # custom per-connection verification cannot apply here.
        lowered = {k.lower(): v for k, v in request.headers.items()}
        verify_telegram_secret(
            headers=lowered,
            webhook_secret=env.channels.telegram.webhook_secret or "",
            channel="telegram_hosted",
        )

        update = _parse_update(body)
        chat_id = _update_chat_id(update)
        sender_id = _update_sender_id(update)
        text = _update_text(update)
        if chat_id is None:
            return ChannelEventAck(status="accepted")

        # The bind command. Consume the one-time token, then greet. A bad or
        # spent token is a user-facing message, never a 500.
        start_token = _start_command_token(text)
        if start_token is not None:
            await self._complete_hosted_bind(
                adapter=adapter,
                token=start_token,
                bot_id=bot_id,
                chat_id=str(chat_id),
                sender_id=str(sender_id) if sender_id is not None else "",
            )
            return ChannelEventAck(status="accepted")

        # An ordinary message or a button press. Route it to the bound project.
        binding = await self.telegram_binding_service.resolve_bound_connection(
            bot_id=bot_id, chat_id=str(chat_id)
        )
        if binding is None:
            # Not connected yet. Silent: the connect link is how a chat binds,
            # and an unsolicited reply to any chat that messages the public bot
            # would be noise.
            return ChannelEventAck(status="accepted")

        connection = await self.channels_service.fetch_connection(
            project_id=binding.project_id,
            connection_id=binding.connection_id,
        )
        if connection is None:
            return ChannelEventAck(status="accepted")

        inbound = await adapter.parse_event(body=body, connection=connection)
        if inbound is None:
            return ChannelEventAck(status="accepted")

        await self._record_and_enqueue(
            project_id=binding.project_id,
            connection_id=binding.connection_id,
            channel="telegram_hosted",
            inbound=inbound,
        )
        return ChannelEventAck(status="accepted")

    async def _complete_hosted_bind(
        self, *, adapter, token: str, bot_id: str, chat_id: str, sender_id: str
    ) -> None:
        try:
            binding = await self.telegram_binding_service.consume_bind_token(
                token=token, bot_id=bot_id, chat_id=chat_id, sender_id=sender_id
            )
        except BindTokenError as e:
            await self._hosted_say(
                adapter,
                chat_id,
                "That connection link is not valid anymore. Please generate a "
                "new one from Agenta and try again.",
            )
            log.info("[CHANNELS] hosted telegram bind refused: %s", type(e).__name__)
            return

        connection = await self.channels_service.fetch_connection(
            project_id=binding.project_id,
            connection_id=binding.connection_id,
        )
        greeting = "You are connected. Send a message and your agent will reply."
        if connection is not None:
            await self._hosted_say(adapter, chat_id, greeting, connection=connection)

    async def _hosted_say(
        self, adapter, chat_id: str, text: str, *, connection=None
    ) -> None:
        """A plain bot message on the hosted bot. Best-effort: a greeting that
        fails to send never fails the webhook."""
        try:
            await adapter.post_message(
                connection=connection,
                locator={"chat_id": int(chat_id)},
                content=[{"type": "text", "text": text}],
                idempotency_key=None,
            )
        except Exception as e:  # noqa: BLE001 - a greeting is never load-bearing
            log.info("[CHANNELS] hosted greeting failed: %s", e)

    async def _record_and_enqueue(
        self, *, project_id, connection_id, channel: str, inbound
    ) -> None:
        """Store the parsed event and enqueue the dispatch. Shared by the custom
        and hosted telegram paths."""

        event = ChannelInboxEventCreate(
            connection_id=connection_id,
            external_id=inbound.external_id,
            kind=inbound.kind,
            origin=ChannelEventOrigin.PUSHED,
            data=ChannelInboxEventData(
                external_locator=inbound.external_locator,
                processed=inbound.processed,
                space_kind=inbound.space_kind,
                addressed=inbound.addressed,
            ),
        )
        await self.channels_service.record_inbox_event(
            project_id=project_id,
            event=event,
        )
        if self.dispatch_task is not None:
            try:
                await asyncio.wait_for(
                    self.dispatch_task.kiq(
                        project_id=str(project_id),
                        connection_id=str(connection_id),
                        channel=channel,
                        external_id=inbound.external_id,
                    ),
                    timeout=_ENQUEUE_TIMEOUT_SECONDS,
                )
            except Exception as e:
                log.error("Failed to enqueue channel inbox event: %s", e)
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Failed to enqueue channel inbox event",
                ) from e


def _parse_update(body: bytes) -> Dict[str, Any]:
    try:
        return json.loads(body) if body else {}
    except ValueError:
        return {}


def _update_message(update: Dict[str, Any]) -> Dict[str, Any]:
    message = update.get("message")
    if isinstance(message, dict):
        return message
    callback = update.get("callback_query")
    if isinstance(callback, dict):
        msg = callback.get("message")
        if isinstance(msg, dict):
            return msg
    return {}


def _update_chat_id(update: Dict[str, Any]):
    return (_update_message(update).get("chat") or {}).get("id")


def _update_sender_id(update: Dict[str, Any]):
    message = update.get("message")
    if isinstance(message, dict):
        return (message.get("from") or {}).get("id")
    callback = update.get("callback_query")
    if isinstance(callback, dict):
        return (callback.get("from") or {}).get("id")
    return None


def _update_text(update: Dict[str, Any]) -> str:
    message = update.get("message")
    if isinstance(message, dict):
        return message.get("text") or message.get("caption") or ""
    return ""


def _start_command_token(text: str) -> Optional[str]:
    """The bind token of a `/start <token>` deep-link open, else None. Telegram
    sends the deep-link parameter as the argument to /start."""
    if not text:
        return None
    parts = text.strip().split(maxsplit=1)
    head = parts[0].split("@", 1)[0]  # "/start" or "/start@BotName"
    if head != "/start" or len(parts) < 2:
        return None
    token = parts[1].strip()
    return token or None


def _connection_owns_identity(connection: ChannelConnection, external_id: str) -> bool:
    """Checked against the connection's own recorded locator, never against
    the whole of `data` -- a credential or a capability that happened to
    carry the same string would otherwise pass for an identity."""

    if not external_id:
        return False

    data = connection.data if isinstance(connection.data, dict) else {}
    locator = data.get("connection_locator")
    if not isinstance(locator, dict):
        return False

    # A declared-but-absent field is stored empty; it identifies nothing.
    return external_id in {value for value in locator.values() if value}


def _slack_url_verification_challenge(body: bytes) -> Optional[str]:
    """The challenge string of a Slack URL-verification handshake, else None."""
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    if not isinstance(payload, dict) or payload.get("type") != "url_verification":
        return None
    challenge = payload.get("challenge")
    return challenge if isinstance(challenge, str) and challenge else None
