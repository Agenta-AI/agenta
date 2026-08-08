import asyncio
from functools import wraps
from typing import TYPE_CHECKING, Any, Optional

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger

from oss.src.core.channels.dtos import (
    ChannelEventAck,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelEventOrigin,
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

    async def _ingest(self, *, channel: str, request: Request) -> ChannelEventAck:
        """The shared body. Both handlers are one line calling this with their
        channel; the split exists for the route table and the SDK."""

        body = await request.body()

        adapter = self.adapter_registry.get(channel)

        # Raises ChannelSignatureInvalid on failure -- caught by the decorator,
        # which answers 401 with no verification detail.
        external_id = await adapter.verify_signature(
            headers=request.headers,
            body=body,
        )

        resolved = (
            await self.channels_service.get_project_and_connection_by_external_id(
                channel=channel,
                external_id=external_id,
            )
        )

        if resolved is None:
            # Verified, but no connection installed for this platform id --
            # nothing to write against. Ack so the platform stops retrying.
            return ChannelEventAck(status="accepted", detail="No connection found")

        project_id, connection_id = resolved

        inbound = await adapter.parse_event(body=body)

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
