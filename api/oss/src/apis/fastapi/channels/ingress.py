import asyncio
import hmac
import json
import re
from collections import Counter
from datetime import datetime, timezone
from functools import wraps
from typing import TYPE_CHECKING, Any, Dict, Optional

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import (
    JSONResponse,
    PlainTextResponse,
    Response,
    StreamingResponse,
)

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger
from oss.src.utils.throttling import FailureMode, check_throttle

from oss.src.apis.fastapi.channels.models import (
    EmbedConfigResponse,
    EmbedConversation,
    EmbedConversationResponse,
    EmbedConversationsResponse,
)
from oss.src.apis.fastapi.mounts.utils import _content_disposition_attachment
from oss.src.apis.fastapi.sessions.live_events import live_event_stream
from oss.src.dbs.redis.sessions.contract import live_events_channel
from oss.src.dbs.redis.shared.engine import get_streams_engine
from oss.src.core.sessions.attachments.types import AttachmentNotFound

from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelEventAck,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelEventOrigin,
    ChannelKeyGrain,
    ChannelRequestContext,
    ChannelSpaceQuery,
    ChannelThread,
    ChannelThreadQuery,
)
from oss.src.core.channels.types import (
    ChannelLocatorIncomplete,
    ChannelNotSupported,
    ChannelSignatureInvalid,
)
from oss.src.core.channels.utils import compose_external_key
from oss.src.core.channels.adapters.embed.adapter import (
    allowed_origins,
    parse_body,
    visitor_key,
    visitor_key_hash,
    visitor_locator,
)
from oss.src.core.channels.adapters.telegram.signature import verify_telegram_secret
from oss.src.core.channels.adapters.whatsapp.mapping import (
    phone_number_id_from_verify_token,
    phone_number_ids,
)
from oss.src.core.channels.telegram_binding import (
    BindTokenError,
    ChatAlreadyConnected,
    ChatBoundElsewhere,
)
from oss.src.utils.env import env

if TYPE_CHECKING:
    # Imported only for typing so this module never hard-depends on them.
    from oss.src.core.channels.service import ChannelsService
    from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
    from oss.src.core.sessions.attachments.service import SessionAttachmentsService
    from oss.src.core.sessions.records.service import RecordsService
    from oss.src.core.channels.telegram_binding import TelegramBindingService

log = get_module_logger(__name__)

_ENQUEUE_TIMEOUT_SECONDS = 5.0

# The embed id is minted by token_urlsafe. Anything else is refused before it
# reaches a throttle key or the database.
_EMBED_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
# Room for the JSON around the text, the context and the base64 files.
_EMBED_BODY_OVERHEAD_BYTES = 64 * 1024
# Each file becomes one attachment write in the worker; bound the count too.
_EMBED_MAX_FILES = 10
_EPOCH = datetime.min.replace(tzinfo=timezone.utc)
# Open widget streams per embed in this process. A stream holds a Redis
# connection for as long as the visitor keeps it, which a request rate cannot bound.
_embed_live_streams: Counter = Counter()


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
        records_service: Optional["RecordsService"] = None,
        attachments_service: Optional["SessionAttachmentsService"] = None,
    ):
        self.channels_service = channels_service
        self.adapter_registry = adapter_registry
        self.dispatch_task = dispatch_task
        # Present only when the hosted (Agenta-owned) Telegram bot is configured
        # for this deployment. Absent means every telegram update takes the
        # custom-bot path.
        self.telegram_binding_service = telegram_binding_service
        # Used only by the embed read routes.
        self.records_service = records_service
        self.attachments_service = attachments_service

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

        # WhatsApp: Meta proves the URL with a GET handshake before it sends
        # any event, then POSTs signed events to the same URL.
        self.router.add_api_route(
            "/whatsapp/events/",
            self.verify_whatsapp_webhook,
            methods=["GET"],
            operation_id="verify_whatsapp_webhook",
            response_class=PlainTextResponse,
        )
        self.router.add_api_route(
            "/whatsapp/events/",
            self.ingest_whatsapp_event,
            methods=["POST"],
            operation_id="ingest_whatsapp_event",
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

        # The public widget. The visitor key header is the credential, and the
        # route limits its own rate: no organization is known before it runs.
        self.router.add_api_route(
            "/embed/events/{embed_id}/",
            self.ingest_embed_event,
            methods=["POST"],
            operation_id="ingest_embed_event",
            response_model=ChannelEventAck,
            status_code=status.HTTP_202_ACCEPTED,
        )
        # What the widget page needs for its frame-ancestors header. No key.
        self.router.add_api_route(
            "/embed/{embed_id}/config",
            self.fetch_embed_config,
            methods=["GET"],
            operation_id="fetch_embed_config",
            response_model=EmbedConfigResponse,
        )
        # The visitor's own conversations. Same credential as the ingress; a
        # thread outside the caller's space answers 404 like an unknown one.
        self.router.add_api_route(
            "/embed/{embed_id}/conversations",
            self.list_embed_conversations,
            methods=["GET"],
            operation_id="list_embed_conversations",
            response_model=EmbedConversationsResponse,
        )
        self.router.add_api_route(
            "/embed/{embed_id}/conversations/{thread_id}",
            self.read_embed_conversation,
            methods=["GET"],
            operation_id="read_embed_conversation",
            response_model=EmbedConversationResponse,
        )
        self.router.add_api_route(
            "/embed/{embed_id}/conversations/{thread_id}/live",
            self.stream_embed_conversation,
            methods=["GET"],
            operation_id="stream_embed_conversation",
            response_class=StreamingResponse,
        )
        self.router.add_api_route(
            "/embed/{embed_id}/conversations/{thread_id}/files/{file_id}",
            self.download_embed_file,
            methods=["GET"],
            operation_id="download_embed_file",
            response_class=Response,
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
    async def ingest_embed_event(self, request: Request, embed_id: str) -> Any:
        if not _EMBED_ID_RE.fullmatch(embed_id):
            raise ChannelSignatureInvalid(channel="embed")
        limits = env.channels.embed

        await _embed_throttle({"embed": embed_id}, limits.requests_per_minute_per_embed)

        key = visitor_key(dict(request.headers))
        if key is None:
            raise ChannelSignatureInvalid(channel="embed")
        # Hashed first: the raw key never becomes part of a Redis key.
        await _embed_throttle(
            {"embed": embed_id, "visitor": visitor_key_hash(key)},
            limits.requests_per_minute_per_key,
        )

        max_body_bytes = (
            -(-limits.max_file_bytes // 3) * 4
            + 16 * limits.max_message_chars
            + _EMBED_BODY_OVERHEAD_BYTES
        )
        body = await _read_body_capped(request, max_body_bytes)
        if body is None:
            return _embed_refusal(413, "The request is too large.")
        refused = _embed_payload_refusal(parse_body(body))
        if refused is not None:
            return refused

        return await self._ingest(channel="embed", request=request)

    @intercept_exceptions()
    async def fetch_embed_config(self, embed_id: str) -> Any:
        resolved = await self.resolve_embed(embed_id)
        if resolved is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Not found"
            )
        connection = resolved[2]
        data = connection.data if isinstance(connection.data, dict) else {}
        appearance = data.get("appearance")
        return EmbedConfigResponse(
            name=connection.name,
            allowed_origins=allowed_origins(connection),
            appearance=appearance if isinstance(appearance, dict) else {},
        )

    async def resolve_embed(self, embed_id: str):
        """The active embed connection for a public embed id, or None. Archived
        rows never resolve; an inactive one is treated as missing."""

        if not _EMBED_ID_RE.fullmatch(embed_id):
            return None
        adapter = self.adapter_registry.get("embed")
        candidate = await self._resolve_candidate(
            channel="embed",
            capabilities=await adapter.fetch_capabilities(connection=None),
            locator={"embed": embed_id},
        )
        if candidate is None or not candidate[2].flags.is_active:
            return None
        return candidate

    async def _embed_visitor(self, request: Request, embed_id: str):
        """The embed's project and connection and the caller's space, which is
        None before the visitor's first message. A missing embed or a weak key
        refuses like the ingress does."""

        key = visitor_key(dict(request.headers))
        if key is None or not _EMBED_ID_RE.fullmatch(embed_id):
            raise ChannelSignatureInvalid(channel="embed")
        # Separate, larger buckets than the ingress: the widget polls the list
        # after a first message and reconnects the live stream.
        limits = env.channels.embed
        await _embed_throttle(
            {"embed_read": embed_id}, limits.read_requests_per_minute_per_embed
        )
        await _embed_throttle(
            {"embed_read": embed_id, "visitor": visitor_key_hash(key)},
            limits.read_requests_per_minute_per_key,
        )
        resolved = await self.resolve_embed(embed_id)
        if resolved is None:
            raise ChannelSignatureInvalid(channel="embed")
        project_id, connection_id, _ = resolved
        space_key = compose_external_key(
            await self.adapter_registry.get("embed").fetch_capabilities(
                connection=None
            ),
            ChannelKeyGrain.SPACE,
            visitor_locator(key),
        )
        spaces = await self.channels_service.query_spaces(
            project_id=project_id,
            space=ChannelSpaceQuery(
                connection_id=connection_id, external_key=space_key
            ),
        )
        return project_id, connection_id, (spaces[0] if spaces else None)

    async def _embed_threads(self, project_id, space) -> list[ChannelThread]:
        if space is None:
            return []
        return await self.channels_service.query_threads(
            project_id=project_id,
            thread=ChannelThreadQuery(space_id=space.id),
        )

    async def _embed_thread(self, request: Request, embed_id: str, thread_id: UUID):
        """The caller's thread, looked up only among its own space's threads,
        so another visitor's thread is never fetched: it is simply absent."""

        project_id, connection_id, space = await self._embed_visitor(request, embed_id)
        for thread in await self._embed_threads(project_id, space):
            if thread.id == thread_id:
                return project_id, connection_id, thread
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def list_embed_conversations(self, request: Request, embed_id: str) -> Any:
        project_id, _, space = await self._embed_visitor(request, embed_id)
        threads = await self._embed_threads(project_id, space)
        threads.sort(key=lambda thread: thread.created_at or _EPOCH, reverse=True)
        # Newest row per session: a reopened conversation adds a row that
        # reuses its session.
        seen = set()
        conversations = []
        for thread in threads:
            if thread.session_id in seen:
                continue
            seen.add(thread.session_id)
            conversations.append(
                EmbedConversation(
                    thread_id=thread.id,
                    session_id=thread.session_id,
                    created_at=thread.created_at,
                    is_active=thread.flags.is_active,
                )
            )
        return EmbedConversationsResponse(
            count=len(conversations), conversations=conversations
        )

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def read_embed_conversation(
        self, request: Request, embed_id: str, thread_id: UUID
    ) -> Any:
        project_id, _, thread = await self._embed_thread(request, embed_id, thread_id)
        records = await self.records_service.get_records(
            project_id=project_id, session_id=thread.session_id
        )
        return EmbedConversationResponse(
            count=len(records),
            records=records,
            pending_choice=thread.data.pending_choice,
        )

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def stream_embed_conversation(
        self,
        request: Request,
        embed_id: str,
        thread_id: UUID,
        after: int = Query(default=0, ge=0),
    ) -> Any:
        if not env.sessions.shared_reader:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        project_id, connection_id, thread = await self._embed_thread(
            request, embed_id, thread_id
        )
        session_id = thread.session_id

        async def authorized() -> bool:
            # A thread never changes space, so the embed still resolving to the
            # same active connection is the whole re-check.
            resolved = await self.resolve_embed(embed_id)
            return resolved is not None and resolved[1] == connection_id

        async def replay(cursor: int):
            return await self.records_service.get_events_after(
                project_id=project_id, session_id=session_id, after=cursor
            )

        stream = live_event_stream(
            channel=live_events_channel(str(project_id), session_id),
            pubsub_factory=lambda: get_streams_engine().get_redis().pubsub(),
            authorization_check=authorized,
            authorization_recheck_seconds=env.sessions.live_auth_recheck_seconds,
            heartbeat_seconds=env.sessions.watch_heartbeat_seconds,
            retry_milliseconds=env.sessions.watch_retry_milliseconds,
            buffer_limit=env.sessions.live_reader_buffer_limit,
            after=after,
            replay_query=replay,
        )
        return _EmbedLiveResponse(
            embed_id,
            stream,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-store",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def download_embed_file(
        self, request: Request, embed_id: str, thread_id: UUID, file_id: UUID
    ) -> Any:
        """A session attachment of the caller's thread. The lookup is scoped by
        the thread's session, so another session's file is not found."""

        project_id, _, thread = await self._embed_thread(request, embed_id, thread_id)
        try:
            content = await self.attachments_service.fetch_attachment_content(
                project_id=project_id,
                session_id=thread.session_id,
                attachment_id=file_id,
            )
        except AttachmentNotFound as e:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Not found"
            ) from e
        return Response(
            content=content.data,
            media_type=content.attachment.media_type,
            headers={
                "Content-Disposition": _content_disposition_attachment(
                    content.attachment.filename
                ),
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

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
    async def verify_whatsapp_webhook(self, request: Request) -> Any:
        """Meta's subscription check: echo `hub.challenge` as plain text when
        `hub.verify_token` is the token a WhatsApp connection handed its
        operator. The token starts with the phone number ID, which picks the
        one connection to compare against. Echoing grants nothing, but an
        unknown token is refused so the URL answers only for its own numbers."""

        params = request.query_params
        token = params.get("hub.verify_token") or ""
        challenge = params.get("hub.challenge") or ""
        phone_number_id = phone_number_id_from_verify_token(token)
        if params.get("hub.mode") == "subscribe" and challenge and phone_number_id:
            adapter = self.adapter_registry.get("whatsapp")
            candidate = await self._resolve_candidate(
                channel="whatsapp",
                capabilities=await adapter.fetch_capabilities(connection=None),
                locator={"phone_number_id": phone_number_id},
            )
            data = candidate[2].data if candidate else None
            expected = (data or {}).get("webhook_verify_token") or ""
            if expected and hmac.compare_digest(
                token.encode("utf-8"), expected.encode("utf-8")
            ):
                return PlainTextResponse(challenge)
        return PlainTextResponse("", status_code=status.HTTP_403_FORBIDDEN)

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def ingest_whatsapp_event(self, request: Request) -> Any:
        # One body can batch messages for several business numbers of the
        # same Meta app. Each number is its own connection, so each is
        # verified and routed on its own. A number not connected here (or
        # connected with another app secret) is skipped; a body where no
        # number verifies is refused like any bad signature.
        accepted = False
        for phone_number_id in phone_number_ids(await request.body()):
            try:
                await self._ingest(
                    channel="whatsapp",
                    request=request,
                    locator={"phone_number_id": phone_number_id},
                )
            except ChannelSignatureInvalid:
                continue
            accepted = True
        if not accepted:
            raise ChannelSignatureInvalid(channel="whatsapp")
        return ChannelEventAck(status="accepted")

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

    async def _ingest(
        self,
        *,
        channel: str,
        request: Request,
        locator: Optional[Dict[str, Any]] = None,
    ) -> ChannelEventAck:
        """The shared body. Both handlers are one line calling this with their
        channel; the split exists for the route table and the SDK. `locator`
        overrides the adapter's own claim, for a body that speaks for several
        installations (WhatsApp)."""

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
            locator=locator or adapter.connection_locator(request=request_context),
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

        inbound = await adapter.parse_event(
            body=body, connection=connection, request=request_context
        )

        # None is platform noise (ack, bot echo) -- not an error, nothing to
        # log. A list is a batched delivery: one row per message.
        if inbound is None:
            inbound = []
        for event in inbound if isinstance(inbound, list) else [inbound]:
            await self._record_and_enqueue(
                project_id=project_id,
                connection_id=connection_id,
                channel=channel,
                inbound=event,
            )
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

        # v1 hosted is private chats only. In a 1:1 chat the sender is the chat,
        # so the bound account is the only participant and attribution is exact.
        # A group would let an unbound member invoke the agent as the binder's
        # account, so group updates are dropped until hosted groups are built.
        if _update_chat_type(update) != "private":
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
        except ChatAlreadyConnected:
            await self._hosted_say(
                adapter,
                chat_id,
                "This chat is already connected to Agenta. To change the agent, "
                "disconnect it in Agenta first.",
            )
            return
        except ChatBoundElsewhere:
            await self._hosted_say(
                adapter,
                chat_id,
                "This Telegram chat is connected to another Agenta project. "
                "Disconnect it from that project first, then create a new connection link.",
            )
            return
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


class _EmbedLiveResponse(StreamingResponse):
    """A live stream that holds one of the embed's slots while it runs. The
    check and the reservation share one step with no await between them, and
    the slot is released whatever way the response ends."""

    def __init__(self, embed_id: str, content: Any, **kwargs: Any) -> None:
        super().__init__(content, **kwargs)
        self.embed_id = embed_id

    async def __call__(self, scope, receive, send) -> None:
        if (
            _embed_live_streams[self.embed_id]
            >= env.channels.embed.max_live_streams_per_embed
        ):
            refusal = JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": "Too many open conversations. Try again later."},
                headers={"Retry-After": "5"},
            )
            await refusal(scope, receive, send)
            return
        _embed_live_streams[self.embed_id] += 1
        try:
            await super().__call__(scope, receive, send)
        finally:
            _embed_live_streams[self.embed_id] -= 1
            if _embed_live_streams[self.embed_id] <= 0:
                del _embed_live_streams[self.embed_id]


def _embed_refusal(status_code: int, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": detail})


async def _embed_throttle(key: Dict[str, str], per_minute: int) -> None:
    """Raise a 429 with Retry-After when the bucket is empty. Fails open: a
    Redis outage must not take every widget down."""

    result = await check_throttle(
        key,
        max_capacity=per_minute,
        refill_rate=per_minute,
        failure_mode=FailureMode.OPEN,
    )
    if not result.allow:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Try again later.",
            headers={"Retry-After": str(int(result.retry_after_seconds) + 1)},
        )


async def _read_body_capped(request: Request, limit: int) -> Optional[bytes]:
    """The body, or None once it passes `limit`, read without holding more."""

    declared = request.headers.get("content-length") or ""
    if declared.isdigit() and int(declared) > limit:
        return None
    chunks = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            return None
        chunks.append(chunk)
    body = b"".join(chunks)
    # Starlette's own body cache, so `_ingest` reads the same bytes again.
    request._body = body
    return body


def _embed_payload_refusal(payload: Dict[str, Any]) -> Optional[JSONResponse]:
    limits = env.channels.embed
    if "bindings" in payload:
        return _embed_refusal(400, "bindings is not supported.")
    text = payload.get("text")
    if isinstance(text, str) and len(text) > limits.max_message_chars:
        return _embed_refusal(413, "The message is too long.")
    context = payload.get("context")
    if context is not None and (
        len(json.dumps(context, ensure_ascii=False)) > limits.max_message_chars
    ):
        return _embed_refusal(413, "The context is too long.")
    files = payload.get("files")
    if isinstance(files, list) and len(files) > _EMBED_MAX_FILES:
        return _embed_refusal(413, "Too many files.")
    encoded = sum(
        len(file.get("data") or "")
        for file in (files if isinstance(files, list) else [])
        if isinstance(file, dict) and isinstance(file.get("data"), str)
    )
    if encoded // 4 * 3 > limits.max_file_bytes:
        return _embed_refusal(413, "The files are too large.")
    return None


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


def _update_chat_type(update: Dict[str, Any]) -> Optional[str]:
    return (_update_message(update).get("chat") or {}).get("type")


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
    stripped = text.strip() if text else ""
    if not stripped:
        return None
    parts = stripped.split(maxsplit=1)
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
