import asyncio
from functools import wraps
from typing import TYPE_CHECKING, Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger

from oss.src.core.channels.dtos import (
    ChannelEventAck,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelEventOrigin,
    ChannelRequestContext,
)
from oss.src.core.channels.types import ChannelNotSupported, ChannelSignatureInvalid

if TYPE_CHECKING:
    # Imported only for typing so this module never hard-depends on them.
    from oss.src.core.channels.service import ChannelsService
    from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry

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
    ):
        self.channels_service = channels_service
        self.adapter_registry = adapter_registry
        self.dispatch_task = dispatch_task

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

        # Bridges share one route -- their channel key is unknown at build time.
        self.router.add_api_route(
            "/bridge/events/",
            self.ingest_bridge_event,
            methods=["POST"],
            operation_id="ingest_bridge_event",
            response_model=ChannelEventAck,
            status_code=status.HTTP_202_ACCEPTED,
        )

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def ingest_slack_event(self, request: Request) -> Any:
        return await self._ingest(channel="slack", request=request)

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def ingest_bridge_event(self, request: Request) -> Any:
        # Every bridge shares this literal channel key; the credential (not
        # this path) resolves which installation is calling, and the adapter
        # is responsible for refusing a payload whose claimed sender
        # disagrees with the credential that signed it.
        return await self._ingest(channel="bridge", request=request)

    async def _resolve_candidate(
        self, *, channel: str, locator: Optional[Dict[str, Any]]
    ):
        """The connection an unverified installation claim points at, or None."""

        hint = _external_id_from_locator(locator)
        if not hint:
            return None

        resolved = (
            await self.channels_service.get_project_and_connection_by_external_id(
                channel=channel,
                external_id=hint,
            )
        )
        if resolved is None:
            return None

        project_id, connection_id = resolved
        connection = await self.channels_service.connections_service.get_connection(
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

        # The signing secret lives on the connection, so the connection has to
        # be in hand before the signature can be checked. The request's own
        # locator selects which one to check against and grants nothing: a
        # wrong claim finds no connection, or one whose secret fails, and
        # both refuse identically below.
        candidate = await self._resolve_candidate(
            channel=channel,
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
        # the secret came from.
        if external_id != connection.integration_key:
            raise ChannelSignatureInvalid(channel=channel)

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


def _external_id_from_locator(locator: Optional[Dict[str, Any]]) -> Optional[str]:
    """Every locator this package's adapters return names exactly one field —
    composing a key over several is the connections table's job, not yet
    built. Standing in for that: the locator's one value, whatever its key."""

    if not locator:
        return None

    value = next(iter(locator.values()), None)
    return str(value) if value is not None else None
