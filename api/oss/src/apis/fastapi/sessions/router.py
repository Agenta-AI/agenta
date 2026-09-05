"""Unified sessions API router.

Composes the sub-domain routers:
  - SessionStreamsRouter  — /sessions/streams/*
  - RecordsRouter        — /sessions/records/*
  - InteractionsRouter   — /sessions/interactions/*
  - SessionTurnsRouter    — /sessions/turns/*
  - SessionsRootRouter    — /sessions/query, /sessions/ (DELETE),
                            /sessions/archive, /sessions/unarchive

peek (S12/E1) is NOT a verb and NOT a server-side aggregate. It is the front-end
composing the individual reads already exposed here:
  1. `POST /sessions/query` (this router)  -> a list of session_ids.
  2. Per session_id: `GET /sessions/streams/?session_id=` (fetch the stream),
     `POST /sessions/turns/query` (turns), `POST /sessions/records/query`
     (records). No overlay/aggregate endpoint exists or is planned.
"""

import re
from functools import wraps
from secrets import compare_digest
from uuid import UUID

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

# FastAPI route params need fastapi.UploadFile; request.form() yields starlette's base class.
from fastapi import UploadFile as FastAPIUploadFile
from starlette.datastructures import UploadFile
from typing import Any, Optional, Union

from oss.src.utils.env import env
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger

from oss.src.dbs.redis.sessions.contract import (
    live_events_channel,
    project_watch_channel,
    watch_channel,
)
from oss.src.dbs.redis.shared.engine import get_lock_engine, get_streams_engine
from oss.src.dbs.redis.sessions.locks import get_running_owner
from oss.src.apis.fastapi.sessions.watch import watch_event_stream
from oss.src.apis.fastapi.sessions.live_events import live_event_stream

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION

# Core domain imports — new paths
from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionHeartbeatRequest,
    SessionHeartbeatResult,
    SessionStreamCommandRequest,
    SessionStreamCommandResponse,
    SessionStreamHeaderEdit,
    SessionStreamQuery,
    SessionStreamQueryFlags,
)
from oss.src.core.sessions.streams.types import (
    ConcurrencyLimitExceeded,
    SessionIdInvalid,
    SessionTurnInUse,
    SessionTurnMismatch,
    SessionStreamAlreadyExists,
    SessionStreamNotFound,
)
from oss.src.core.sessions.streams.service import (
    SessionStreamsService,
    derive_command_mode,
)
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.commands.types import (
    ExecutionExpectationFailed,
    SessionCommandIdempotencyConflict,
    InteractionResponseConflict,
    SessionCommandNotClaimable,
    SessionCommandNotFound,
)
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.records.dtos import (
    MAX_LIVE_FRAME_BYTES,
    SessionLiveFrame,
    SessionRecordEvent,
    TERMINAL_RECORD_TYPE,
)
from oss.src.core.sessions.records.streaming import publish_live_frame, publish_record
from oss.src.core.sessions.interactions.dtos import (
    SessionInteractionCreate,
    SessionInteractionKind,
    SessionInteractionQuery,
    SessionInteractionStatus,
    SessionInteractionTransition,
)
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.interactions.references import resolve_interaction_references
from oss.src.core.sessions.interactions.types import InteractionNotFound
from oss.src.core.sessions.inputs.service import SessionInputsService
from oss.src.core.sessions.inputs.types import (
    SessionInputBusy,
    SessionInputIdempotencyConflict,
    SessionInputNotFound,
    SessionInputNotRemovable,
)
from oss.src.core.sessions.inputs.dtos import PendingInputState
from oss.src.core.sessions.attachments.dtos import Attachment
from oss.src.core.sessions.attachments.service import SessionAttachmentsService
from oss.src.core.sessions.attachments.types import (
    AttachmentConflict,
    AttachmentInvalid,
    AttachmentLengthRequired,
    AttachmentNotFound,
    AttachmentQuotaExceeded,
    AttachmentRequestInvalid,
    AttachmentStateConflict,
    AttachmentTooLarge,
    AttachmentUploadInFlight,
)
from oss.src.core.sessions.mounts.service import SessionMountsService
from oss.src.core.sessions.mounts.dtos import SessionMountQuery
from oss.src.core.sessions.turns.dtos import SessionTurnComplete, SessionTurnCreate
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.core.sessions.turns.types import SessionTurnNotFound
from oss.src.core.sessions.dtos import SessionExpansion
from oss.src.core.sessions.service import SessionsService
from oss.src.core.mounts.service import MountsService
from oss.src.apis.fastapi.mounts.router import handle_mount_exceptions
from oss.src.apis.fastapi.mounts.utils import (
    BINARY_RESPONSE,
    _content_disposition_attachment,
    download_mount_file,
    sign_mount_credentials,
    upload_mount_file,
)
from oss.src.apis.fastapi.mounts.models import (
    MountCredentialsResponse,
    MountFileWrittenResponse,
)
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)
from oss.src.core.workflows.service import WorkflowsService

from oss.src.apis.fastapi.sessions.models import (
    SessionCancelRequest,
    SessionCancelResponse,
    SessionCommandRef,
    SessionCommandSettlement,
    SessionControlOutcomeRequest,
    SessionControlOutcomeResponse,
    SessionContinuationResumeResponse,
    SessionExecutionRef,
    # streams
    SessionDetachRequest,
    SessionStreamQueryRequest,
    SessionStreamResponse,
    SessionStreamsResponse,
    # records
    SessionRecordIngestBody,
    SessionRecordQueryRequest,
    SessionRecordResponse,
    SessionRecordsQueryResponse,
    SessionSnapshotPending,
    SessionSnapshotResponse,
    SessionTranscriptWindowing,
    # interactions
    SessionInteractionCancelStaleRequest,
    SessionInteractionCreateRequest,
    SessionInteractionQueryRequest,
    SessionInteractionRespondRequest,
    SessionInteractionContinuationExecution,
    SessionInteractionContinuationResponse,
    SessionInteractionResolution,
    SessionInteractionResponse,
    SessionInteractionsResponse,
    SessionInteractionTransitionRequest,
    SessionAttachment,
    SessionAttachmentReferenceRequest,
    SessionAttachmentResponse,
    SessionAttachmentsResponse,
    # mounts
    SessionMountQueryRequest,
    SessionMountResponse,  # noqa: F401  (exported for OpenAPI/single-mount future use)
    SessionMountsResponse,
    # turns
    SessionTurnAppendRequest,
    SessionTurnCompleteRequest,
    SessionTurnQueryRequest,
    SessionTurnResponse,
    SessionTurnsResponse,
    # root session-level ops
    SessionQueryRequest,
    SessionResponse,
    SessionsResponse,
    PendingInputResponse,
    PendingInputAdmissionRequest,
    PendingInputAdmissionResponse,
    SessionCapabilities,
    SessionExecutionSnapshot,
)
from oss.src.apis.fastapi.sessions.utils import (
    compute_session_response_windowing,
    normalize_session_query_request,
    sanitize_session_stream,
)

log = get_module_logger(__name__)
_ATTACHMENT_MULTIPART_OVERHEAD_BYTES = 64 * 1024
_MAX_IDEMPOTENCY_KEY_CHARACTERS = 255

# matches the streams contract allowlist (dbs/redis/sessions/contract.py)
_SESSION_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]{1,128}$")


def _session_capabilities() -> SessionCapabilities:
    return SessionCapabilities(
        durable_approvals=env.agenta.sessions.durable_approvals,
        queue=env.agenta.sessions.queue,
        steer=env.agenta.sessions.queue and env.agenta.sessions.steer,
    )


def _idempotency_key_too_long_response() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "code": "validation_error",
            "message": "Idempotency-Key is too long.",
            "retryable": False,
            "details": {"field": "Idempotency-Key", "reason": "too_long"},
            "next_step": "Use an Idempotency-Key of at most 255 characters.",
        },
    )


def _validate_session_id_http(session_id: str) -> None:
    if not _SESSION_ID_RE.match(session_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="session_id contains invalid characters or is empty.",
        )


def _handle_session_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except SessionIdInvalid as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=e.message,
                ) from e
            except SessionTurnInUse as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "message": e.message,
                        "liveness": e.liveness,
                    },
                ) from e
            except SessionTurnMismatch as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "message": e.message,
                        "expected_execution_id": e.expected_turn_id,
                        "actual_execution_id": e.actual_turn_id,
                    },
                ) from e
            except ConcurrencyLimitExceeded as e:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=e.message,
                ) from e
            except SessionStreamNotFound as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=e.message,
                ) from e
            except SessionStreamAlreadyExists as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=e.message,
                ) from e

        return wrapper

    return decorator


def _handle_attachment_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except (AttachmentInvalid, AttachmentRequestInvalid) as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=e.message,
                ) from e
            except AttachmentLengthRequired as e:
                raise HTTPException(
                    status_code=status.HTTP_411_LENGTH_REQUIRED,
                    detail=e.message,
                ) from e
            except AttachmentTooLarge as e:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=e.message,
                ) from e
            except AttachmentQuotaExceeded as e:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=e.message,
                ) from e
            except AttachmentNotFound as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=e.message,
                ) from e
            except AttachmentUploadInFlight as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=e.message,
                    headers={"Retry-After": str(e.retry_after_seconds)},
                ) from e
            except (AttachmentConflict, AttachmentStateConflict) as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=e.message,
                ) from e

        return wrapper

    return decorator


def _to_session_attachment(attachment: Attachment) -> SessionAttachment:
    return SessionAttachment(
        attachment_id=attachment.id,
        filename=attachment.filename,
        media_type=attachment.media_type,
        size=attachment.size,
        created_at=attachment.created_at,
    )


# ---------------------------------------------------------------------------
# Sub-routers
# ---------------------------------------------------------------------------


class SessionStreamsRouter:
    """Streams sub-router — /sessions/streams/*"""

    def __init__(
        self,
        *,
        service: SessionStreamsService,
        interactions_service: SessionInteractionsService,
        records_service: Optional[RecordsService] = None,
    ) -> None:
        self._service = service
        self._interactions_service = interactions_service
        self._records_service = records_service
        self.router = APIRouter()

        # Unified collection surface on /sessions/streams/, keyed by ?session_id=.
        self.router.add_api_route(
            "/sessions/streams/",
            self.fetch_session_stream,
            methods=["GET"],
            operation_id="fetch_session_stream",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/streams/",
            self.set_session_stream,
            methods=["POST"],
            operation_id="set_session_stream",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/streams/",
            self.delete_session_stream,
            methods=["DELETE"],
            operation_id="delete_session_stream",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/streams/query",
            self.query_session_streams,
            methods=["POST"],
            operation_id="query_session_streams",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/streams/detach",
            self.detach_session_stream,
            methods=["POST"],
            operation_id="detach_session_stream",
            tags=["Sessions"],
        )

        self.router.add_api_route(
            "/sessions/streams/heartbeat",
            self.heartbeat_session_stream,
            methods=["POST"],
            operation_id="heartbeat_session_stream",
            tags=["Sessions"],
        )

        self.router.add_api_route(
            "/sessions/streams/header",
            self.set_session_stream_header,
            methods=["PUT", "POST"],
            operation_id="set_session_stream_header",
            tags=["Sessions"],
        )

        self.router.add_api_route(
            "/sessions/streams/watch",
            self.watch_session_stream,
            methods=["GET"],
            operation_id="watch_session_stream",
            tags=["Sessions"],
            response_model=None,
        )
        self.router.add_api_route(
            "/sessions/{session_id}/events",
            self.session_events,
            methods=["GET"],
            operation_id="watch_session_events",
            tags=["Sessions"],
            response_model=None,
        )
        self.router.add_api_route(
            "/sessions/watch",
            self.watch_project,
            methods=["GET"],
            operation_id="watch_project",
            tags=["Sessions"],
            response_model=None,
        )

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def set_session_stream(
        self,
        request: Request,
        payload: SessionStreamCommandRequest,
    ) -> SessionStreamCommandResponse:
        # Use Redis time before database waits can reorder cancellation against a new turn.
        arrived_at_ms = await self._service.clock_ms()

        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        mode = derive_command_mode(payload)

        # A cancel starts nothing, so the per-project concurrency limit must not gate it. Before
        # this, a project at its limit could not stop the very runs that held the limit — the one
        # request that frees capacity was the one refused with 429.
        if mode != CommandMode.cancel:
            await self._service.check_runner_concurrency_limit(project_id=project_id)

        response = await self._service.command(
            arrived_at_ms=arrived_at_ms,
            project_id=project_id,
            user_id=user_id,
            request=payload,
        )

        if mode == CommandMode.cancel:
            # Close only the displaced turns' gates; the service publishes their watch events.
            try:
                for turn_id in response.cancelled_turn_ids:
                    await self._interactions_service.cancel_session_pending(
                        project_id=UUID(str(project_id)),
                        session_id=response.session_id,
                        only_turn_id=turn_id,
                    )
                if not response.cancelled_turn_ids:
                    await self._interactions_service.cancel_session_pending(
                        project_id=UUID(str(project_id)),
                        session_id=response.session_id,
                    )
            except Exception:
                log.error(
                    "[SESSIONS] accepted Stop interaction cleanup failed",
                    exc_info=True,
                    project_id=str(project_id),
                    session_id=response.session_id,
                )

        return response

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def fetch_session_stream(
        self,
        request: Request,
        session_id: str = Query(...),
    ) -> SessionStreamResponse:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        stream = await self._service.fetch(
            project_id=UUID(str(project_id)),
            session_id=session_id,
        )
        return SessionStreamResponse(
            stream=sanitize_session_stream(stream),
            capabilities=_session_capabilities(),
        )

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def delete_session_stream(
        self,
        request: Request,
        session_id: str = Query(...),
    ) -> dict:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        await self._service.kill(
            project_id=UUID(str(project_id)),
            user_id=UUID(str(user_id)),
            session_id=session_id,
        )
        # kill orphans every pending gate — no one will answer them.
        await self._interactions_service.cancel_session_pending(
            project_id=UUID(str(project_id)),
            session_id=session_id,
        )
        return {"ok": True}

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def detach_session_stream(
        self,
        request: Request,
        payload: SessionDetachRequest,
    ) -> dict:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        await self._service.detach(
            project_id=UUID(str(project_id)),
            user_id=UUID(str(user_id)),
            session_id=payload.session_id,
            watcher_id=payload.watcher_id,
        )
        return {"ok": True}

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def heartbeat_session_stream(
        self,
        request: Request,
        payload: SessionHeartbeatRequest,
    ) -> SessionHeartbeatResult:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        if payload.release_owner:
            _assert_runner_token(request)

        heartbeat = await self._service.heartbeat(
            project_id=project_id,
            request=payload,
        )
        return heartbeat.model_copy(
            update={"stream": sanitize_session_stream(heartbeat.stream)}
        )

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def query_session_streams(
        self,
        request: Request,
        payload: SessionStreamQueryRequest,
    ) -> SessionStreamsResponse:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        streams = await self._service.query_streams(
            project_id=project_id,
            filter=SessionStreamQuery(
                session_id=payload.session_id,
                flags=SessionStreamQueryFlags(
                    is_alive=payload.is_alive,
                    is_running=payload.is_running,
                ),
            ),
        )
        return SessionStreamsResponse(
            count=len(streams),
            streams=[sanitize_session_stream(stream) for stream in streams],
        )

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def set_session_stream_header(
        self,
        request: Request,
        *,
        header: SessionStreamHeaderEdit,
        session_id: str = Query(...),
    ) -> SessionStreamResponse:
        _validate_session_id_http(session_id)

        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        stream = await self._service.set_header(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            session_id=session_id,
            header=header,
        )
        return SessionStreamResponse(stream=sanitize_session_stream(stream))

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def watch_session_stream(
        self,
        request: Request,
        session_id: str = Query(...),
    ) -> StreamingResponse:
        """Server-sent events relay for one session (M3 live relay).

        Emits change notifications only — never record payloads; clients
        revalidate through the regular query endpoints on each event:

        - ``event: records-changed`` — ``{"session_id"}``; new/updated rows
          landed in the record log (published post-DB-commit).
        - ``event: lifecycle`` — ``{"session_id", "state": "running"|"ended"}``.
        - ``event: interaction`` — ``{"session_id", "status": "pending"|"resolved"}``.
        - ``: heartbeat`` comment frames while idle (keep-alive).

        Auth is the standard middleware (cookie ``sAccessToken``, ApiKey, or
        Bearer) evaluated once at connect; scope is the credential's project.
        Browsers authenticate by cookie — ``EventSource`` cannot set headers —
        so a connect landing on an expired access token 401s like any other
        request. There is no interceptor to refresh-and-retry a stream, so the
        client must refresh the session itself and reopen (see the web hooks).

        The stream has no replay/cursor semantics — ``EventSource`` reconnects
        and clients revalidate once on every ``open``, which covers any missed
        notifications.

        NOTE (spec surface): this route appears in OpenAPI for documentation,
        but Fern does not model SSE — consume it with a native ``EventSource``
        (same-origin ``/api`` + cookie auth needs no custom headers), not the
        generated client.
        """
        _validate_session_id_http(session_id)
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        stream = watch_event_stream(
            channel=watch_channel(str(project_id), session_id),
            # One pubsub connection per SSE connection (v1 — simplest correct
            # teardown story; revisit with a shared listener if counts grow).
            pubsub_factory=lambda: get_streams_engine().get_redis().pubsub(),
            heartbeat_seconds=env.sessions.watch_heartbeat_seconds,
            retry_milliseconds=env.sessions.watch_retry_milliseconds,
        )
        return StreamingResponse(
            stream,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                # Disable proxy buffering so frames flush immediately.
                "X-Accel-Buffering": "no",
            },
        )

    @intercept_exceptions()
    async def session_events(
        self,
        request: Request,
        session_id: str,
        after: int = Query(default=0, ge=0),
    ) -> StreamingResponse:
        if not env.sessions.shared_reader:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

        _validate_session_id_http(session_id)
        project_id = str(request.state.project_id)
        user_id = str(request.state.user_id)

        async def authorized() -> bool:
            return await check_action_access(
                user_uid=user_id,
                project_id=project_id,
                permission=Permission.VIEW_SESSIONS,
            )

        if not await authorized():
            raise FORBIDDEN_EXCEPTION
        if self._records_service is None:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        async def replay(cursor: int):
            return await self._records_service.get_events_after(
                project_id=UUID(project_id),
                session_id=session_id,
                after=cursor,
            )

        stream = live_event_stream(
            channel=live_events_channel(project_id, session_id),
            pubsub_factory=lambda: get_streams_engine().get_redis().pubsub(),
            authorization_check=authorized,
            authorization_recheck_seconds=env.sessions.live_auth_recheck_seconds,
            heartbeat_seconds=env.sessions.watch_heartbeat_seconds,
            retry_milliseconds=env.sessions.watch_retry_milliseconds,
            buffer_limit=env.sessions.live_reader_buffer_limit,
            after=after,
            replay_query=replay,
        )
        return StreamingResponse(
            stream,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-store",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @intercept_exceptions()
    async def watch_project(
        self,
        request: Request,
        project_id: UUID = Query(...),
    ) -> StreamingResponse:
        """Relay low-frequency entity changes for the authorized project.

        A caller with only one required view permission cannot open this stream and falls back to
        the lists' polling behavior.
        """
        user_id = request.state.user_id
        authorized_project_id = request.state.project_id

        can_view_sessions = await check_action_access(
            user_uid=str(user_id),
            project_id=str(authorized_project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        can_view_workflows = await check_action_access(
            user_uid=str(user_id),
            project_id=str(authorized_project_id),
            permission=Permission.VIEW_WORKFLOWS,
        )
        if not (can_view_sessions and can_view_workflows):
            raise FORBIDDEN_EXCEPTION

        stream = watch_event_stream(
            channel=project_watch_channel(str(authorized_project_id)),
            pubsub_factory=lambda: get_streams_engine().get_redis().pubsub(),
            heartbeat_seconds=env.sessions.watch_heartbeat_seconds,
            retry_milliseconds=env.sessions.watch_retry_milliseconds,
        )
        return StreamingResponse(
            stream,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )


class RecordsRouter:
    """Records sub-router — /sessions/records/*"""

    def __init__(
        self,
        records_service: RecordsService,
        commands_service: Optional[SessionCommandsService] = None,
    ):
        self.records_service = records_service
        self.commands_service = commands_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/query",
            self.query_records,
            methods=["POST"],
            operation_id="query_records",
            status_code=status.HTTP_200_OK,
            response_model=SessionRecordsQueryResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{record_id}",
            self.get_record_event,
            methods=["GET"],
            operation_id="get_record_event",
            status_code=status.HTTP_200_OK,
            response_model=SessionRecordResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/ingest",
            self.ingest_record_event,
            methods=["POST"],
            operation_id="ingest_record",
            tags=["Sessions"],
        )

    @intercept_exceptions()
    async def query_records(
        self,
        request: Request,
        *,
        query_request: SessionRecordQueryRequest,
    ) -> Union[SessionRecordsQueryResponse, JSONResponse]:
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        records = (
            await self.records_service.get_records(
                project_id=UUID(request.state.project_id),
                session_id=query_request.session_id,
            )
            if query_request.windowing is None
            else None
        )
        if query_request.windowing is not None:
            page = await self.records_service.get_records_page(
                project_id=UUID(request.state.project_id),
                session_id=query_request.session_id,
                offset=query_request.windowing.offset,
                limit=query_request.windowing.limit,
                through_sequence=query_request.windowing.through_sequence,
            )
            return SessionRecordsQueryResponse(
                count=len(page.records),
                records=page.records,
                windowing=SessionTranscriptWindowing(
                    offset=page.next_offset
                    if page.next_offset is not None
                    else page.offset,
                    limit=page.limit,
                    through_sequence=page.through_sequence,
                )
                if page.next_offset is not None
                else None,
            )
        return SessionRecordsQueryResponse(
            count=len(records),
            records=records,
        )

    @intercept_exceptions()
    async def get_record_event(
        self,
        request: Request,
        record_id: UUID,
    ) -> Union[SessionRecordResponse, JSONResponse]:
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        record = await self.records_service.get_event(
            project_id=UUID(request.state.project_id),
            record_id=record_id,
        )
        return SessionRecordResponse(record=record)

    @intercept_exceptions()
    async def ingest_record_event(
        self,
        request: Request,
        body: SessionRecordIngestBody,
    ) -> dict:
        project_id = request.state.project_id
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=project_id,
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        if isinstance(body, list):
            if not body or any(item.kind != "frame" for item in body):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Batched record ingest accepts live frames only.",
                )
            frames = body
        else:
            frames = [body] if body.kind == "frame" else []

        if frames:
            first = frames[0]
            _validate_session_id_http(first.session_id)
            if any(
                frame.session_id != first.session_id
                or frame.execution_id != first.execution_id
                for frame in frames[1:]
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="A live frame batch must share one session and execution.",
                )
            content_length = request.headers.get("content-length")
            if content_length is not None:
                try:
                    request_size = int(content_length)
                except ValueError as error:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Content-Length must be an integer.",
                    ) from error
                if request_size < 0:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Content-Length cannot be negative.",
                    )
                if request_size > MAX_LIVE_FRAME_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        detail=(
                            f"Live frame request exceeds {MAX_LIVE_FRAME_BYTES} bytes."
                        ),
                    )
            current_execution_id = await get_running_owner(
                get_lock_engine(),
                project_id=str(project_id),
                session_id=first.session_id,
            )
            if current_execution_id != first.execution_id:
                raise FORBIDDEN_EXCEPTION
            for frame in frames:
                await publish_live_frame(
                    organization_id=UUID(request.state.organization_id),
                    project_id=UUID(project_id),
                    frame=SessionLiveFrame(
                        version=frame.version,
                        kind="frame",
                        session_id=frame.session_id,
                        execution_id=frame.execution_id,
                        frame_or_event_id=frame.frame_or_event_id,
                        frame_index=frame.frame_index,
                        entity_id=frame.entity_id,
                        type=frame.type,
                        payload=frame.payload,
                        created_at=frame.created_at,
                    ),
                )
            return {"ok": True}

        assert not isinstance(body, list)
        # For a finished continuation, commit the core execution outcome before accepting its
        # terminal record into the asynchronous tracing stream. This closes the cross-database
        # window where the watchdog could see no `done`, expose recovery, and replay work that
        # had already finished while the records worker was still settling core state.
        if (
            (env.agenta.sessions.durable_approvals or env.agenta.sessions.queue)
            and self.commands_service is not None
            and body.record_type == TERMINAL_RECORD_TYPE
            and body.turn_id
            and (body.attributes or {}).get("stopReason")
            not in ("paused", "cancelled", "error")
        ):
            await self.commands_service.settle_execution_completed(
                project_id=UUID(project_id),
                session_id=body.session_id,
                execution_id=body.turn_id,
            )

        published = await publish_record(
            organization_id=UUID(request.state.organization_id),
            project_id=UUID(project_id),
            record_event=SessionRecordEvent(
                project_id=UUID(project_id),
                session_id=body.session_id,
                record_id=body.record_id,
                record_index=body.record_index,
                timestamp=body.timestamp,
                record_type=body.record_type,
                record_source=body.record_source,
                attributes=body.attributes,
                turn_id=body.turn_id,
                span_id=body.span_id,
            ),
        )
        if not published:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Record ingestion is temporarily unavailable.",
            )
        return {"ok": True}


class InteractionsRouter:
    """Interactions sub-router — /sessions/interactions/*"""

    def __init__(
        self,
        *,
        interactions_service: SessionInteractionsService,
        workflows_service: WorkflowsService,
        respond_task: Optional[Any] = None,
        # InteractionsDispatcher (typed loosely, like respond_task: the API layer does not
        # import the tasks layer). When present, the no-worker respond fallback goes through
        # it so both paths share ONE answer-composition implementation.
        interactions_dispatcher: Optional[Any] = None,
        commands_service: Optional[SessionCommandsService] = None,
        turns_service: Optional[SessionTurnsService] = None,
        streams_service: Optional[SessionStreamsService] = None,
    ) -> None:
        self.interactions_service = interactions_service
        self.workflows_service = workflows_service
        self.respond_task = respond_task
        self.interactions_dispatcher = interactions_dispatcher
        self.commands_service = commands_service
        self.turns_service = turns_service
        self.streams_service = streams_service

        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.create_interaction,
            methods=["POST"],
            operation_id="create_interaction",
        )
        self.router.add_api_route(
            "/query",
            self.query_interactions,
            methods=["POST"],
            operation_id="query_interactions",
        )
        self.router.add_api_route(
            "/transition",
            self.transition_interaction,
            methods=["POST"],
            operation_id="transition_interaction",
        )
        self.router.add_api_route(
            "/cancel-stale",
            self.cancel_stale_interactions,
            methods=["POST"],
            operation_id="cancel_stale_interactions",
        )
        self.router.add_api_route(
            "/{interaction_id}",
            self.fetch_interaction,
            methods=["GET"],
            operation_id="fetch_interaction",
        )
        self.router.add_api_route(
            "/{interaction_id}/respond",
            self.respond_interaction,
            methods=["POST"],
            operation_id="respond_interaction",
        )

    @intercept_exceptions()
    async def create_interaction(
        self,
        request: Request,
        body: SessionInteractionCreateRequest,
    ) -> SessionInteractionResponse:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        interaction = await self.interactions_service.create_interaction(
            project_id=project_id,
            user_id=user_id,
            interaction=SessionInteractionCreate(
                project_id=project_id,
                session_id=body.session_id,
                turn_id=body.turn_id,
                token=body.token,
                kind=body.kind,
                data=body.data,
                flags=body.flags,
                tags=body.tags,
                meta=body.meta,
            ),
        )
        return SessionInteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def transition_interaction(
        self,
        request: Request,
        body: SessionInteractionTransitionRequest,
    ) -> SessionInteractionResponse:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        resolution = body.resolution
        # `resolved` is approval-only whether or not an answer rides along, so the row lookup
        # runs for a bare `resolved` transition too.
        if resolution is not None or body.status == SessionInteractionStatus.resolved:
            interactions = await self.interactions_service.query_interactions(
                project_id=project_id,
                query=SessionInteractionQuery(session_id=body.session_id),
            )
            source = next(
                (
                    interaction
                    for interaction in interactions
                    if interaction.token == body.token
                ),
                None,
            )
            if source is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Interaction not found or already terminal",
                )
            if (
                body.status == SessionInteractionStatus.resolved
                and source.kind != SessionInteractionKind.user_approval
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Resolved status is not valid for {source.kind.value} interactions",
                )
            if (
                resolution is not None
                and source.kind == SessionInteractionKind.user_approval
            ):
                try:
                    SessionInteractionResolution.model_validate(resolution)
                except ValidationError as e:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=e.errors(include_context=False),
                    ) from e

        try:
            interaction = await self.interactions_service.transition_interaction(
                transition=SessionInteractionTransition(
                    project_id=project_id,
                    session_id=body.session_id,
                    token=body.token,
                    status=body.status,
                    resolution=resolution,
                ),
            )
        except InteractionNotFound:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interaction not found or already terminal",
            )
        return SessionInteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def cancel_stale_interactions(
        self,
        request: Request,
        body: SessionInteractionCancelStaleRequest,
    ) -> dict:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        cancelled = await self.interactions_service.cancel_session_pending(
            project_id=project_id,
            session_id=body.session_id,
            except_turn_id=body.turn_id,
            except_tokens=body.tokens,
        )
        return {"cancelled": cancelled}

    @intercept_exceptions()
    async def query_interactions(
        self,
        request: Request,
        body: SessionInteractionQueryRequest,
    ) -> SessionInteractionsResponse:
        project_id: UUID = request.state.project_id

        authorized = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not authorized:
            raise FORBIDDEN_EXCEPTION

        interactions = await self.interactions_service.query_interactions(
            project_id=project_id,
            query=body.query,
            windowing=body.windowing,
        )
        return SessionInteractionsResponse(
            count=len(interactions), interactions=interactions
        )

    @intercept_exceptions()
    async def fetch_interaction(
        self,
        request: Request,
        interaction_id: UUID,
    ) -> SessionInteractionResponse:
        project_id: UUID = request.state.project_id

        authorized = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not authorized:
            raise FORBIDDEN_EXCEPTION

        try:
            interaction = await self.interactions_service.fetch_interaction(
                project_id=project_id,
                interaction_id=interaction_id,
            )
        except InteractionNotFound:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interaction not found",
            )
        return SessionInteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def respond_interaction(
        self,
        request: Request,
        interaction_id: UUID,
        body: SessionInteractionRespondRequest,
    ) -> Any:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        authorized = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not authorized:
            raise FORBIDDEN_EXCEPTION

        if body.answers is not None and interaction_id not in {
            item.interaction_id for item in body.answers
        }:
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "code": "validation_error",
                    "message": "The path interaction must be included in answers.",
                    "retryable": False,
                    "details": {"field": "answers", "reason": "anchor_missing"},
                },
            )

        if env.agenta.sessions.durable_approvals and self.commands_service is not None:
            idempotency_key = (request.headers.get("Idempotency-Key") or "").strip()
            if not idempotency_key:
                return JSONResponse(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    content={
                        "code": "validation_error",
                        "message": "Idempotency-Key is required for a durable response.",
                        "retryable": False,
                        "details": {"field": "Idempotency-Key", "reason": "required"},
                        "next_step": "Retry with a stable Idempotency-Key header.",
                    },
                )
            if len(idempotency_key) > _MAX_IDEMPOTENCY_KEY_CHARACTERS:
                return _idempotency_key_too_long_response()
            if body.answer is None and body.answers is None:
                return JSONResponse(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    content={
                        "code": "validation_error",
                        "message": "answer is required for a durable response.",
                        "retryable": False,
                        "details": {"field": "answer", "reason": "required"},
                    },
                )
            interaction_answers = (
                [(item.interaction_id, item.answer) for item in body.answers]
                if body.answers is not None
                else [(interaction_id, body.answer)]
            )
            try:
                if body.answers is not None:
                    admission = await self.commands_service.respond_interactions(
                        project_id=UUID(str(project_id)),
                        user_id=UUID(str(user_id)),
                        interaction_answers=interaction_answers,
                        expected_execution_id=body.expected_execution_id,
                        idempotency_key=idempotency_key,
                    )
                else:
                    admission = await self.commands_service.respond_interaction(
                        project_id=UUID(str(project_id)),
                        user_id=UUID(str(user_id)),
                        interaction_id=interaction_id,
                        answer=body.answer,
                        expected_execution_id=body.expected_execution_id,
                        idempotency_key=idempotency_key,
                    )
            except InteractionResponseConflict as error:
                return JSONResponse(
                    status_code=(
                        status.HTTP_422_UNPROCESSABLE_ENTITY
                        if error.code == "validation_error"
                        else status.HTTP_409_CONFLICT
                    ),
                    content={
                        "code": error.code,
                        "message": error.message,
                        "retryable": False,
                        **({"details": error.details} if error.details else {}),
                    },
                )

            response = SessionInteractionContinuationResponse(
                interaction=admission.interaction,
                command=(
                    SessionCommandRef(
                        id=admission.command.id,
                        state=admission.command.state.value,
                    )
                    if admission.command is not None
                    else None
                ),
                execution=SessionInteractionContinuationExecution(
                    id=admission.execution_id,
                    state=(
                        "awaiting_interactions"
                        if getattr(admission, "waiting_for_interactions", False)
                        else admission.execution_state.value
                    ),
                ),
            )
            return JSONResponse(
                status_code=status.HTTP_202_ACCEPTED,
                content=response.model_dump(mode="json"),
            )

        if body.answers is not None:
            responses = {}
            for item in body.answers:
                responses[item.interaction_id] = await self.respond_interaction(
                    request=request,
                    interaction_id=item.interaction_id,
                    body=SessionInteractionRespondRequest(answer=item.answer),
                )
            return responses[interaction_id]

        try:
            interaction = await self.interactions_service.fetch_interaction(
                project_id=project_id,
                interaction_id=interaction_id,
            )
        except InteractionNotFound:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interaction not found",
            )

        if (
            interaction.status
            and interaction.status != SessionInteractionStatus.pending
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Interaction is no longer pending",
            )

        answer = body.answer or {}

        # CAS flips first: only the responder that wins the row enqueues, so
        # concurrent responds fire exactly once.
        try:
            interaction = await self.interactions_service.transition_interaction(
                transition=SessionInteractionTransition(
                    project_id=project_id,
                    session_id=interaction.session_id,
                    token=interaction.token,
                    status=SessionInteractionStatus.responded,
                ),
            )
        except InteractionNotFound:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Interaction is no longer pending",
            )

        # Enqueue onto the interactions worker when wired; otherwise fall back to the
        # dispatcher directly (same answer composition, fired in-process), or as a last
        # resort an inline blocking invoke (keeps minimal/test compositions usable).
        if self.respond_task is not None:
            await self.respond_task.kiq(
                project_id=str(project_id),
                user_id=str(user_id),
                interaction_id=str(interaction_id),
                answer=answer,
            )
        elif self.interactions_dispatcher is not None:
            await self.interactions_dispatcher.respond(
                project_id=UUID(str(project_id)),
                user_id=UUID(str(user_id)),
                interaction_id=interaction_id,
                answer=answer,
            )
        else:
            references = await resolve_interaction_references(
                project_id=UUID(str(project_id)),
                interaction=interaction,
                turns_service=self.turns_service,
                streams_service=self.streams_service,
            )
            selector = (
                interaction.data.selector.model_dump(mode="json")
                if interaction.data and interaction.data.selector
                else None
            )

            invoke_request = WorkflowServiceRequest(
                references=references,
                selector=selector,
                data=WorkflowServiceRequestData(inputs=answer),
                session_id=interaction.session_id,
            )

            await self.workflows_service.invoke_workflow(
                project_id=project_id,
                user_id=user_id,
                request=invoke_request,
            )

        return SessionInteractionResponse(count=1, interaction=interaction)


class SessionAttachmentsRouter:
    def __init__(
        self,
        *,
        attachments_service: SessionAttachmentsService,
    ) -> None:
        self.attachments_service = attachments_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/attachments",
            self.create_session_attachment,
            methods=["POST"],
            operation_id="create_session_attachment",
            response_model=SessionAttachmentResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/attachments/{attachment_id}/content",
            self.download_session_attachment_content,
            methods=["GET"],
            operation_id="download_session_attachment_content",
            response_model=None,
            response_class=Response,
            responses=BINARY_RESPONSE,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/attachments/reference",
            self.reference_session_attachments,
            methods=["POST"],
            operation_id="reference_session_attachments",
            response_model=SessionAttachmentsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )

    async def _check(self, request: Request, permission: Permission) -> None:
        # Session-only permissions keep the protected mount out of the authorization model.
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=permission,
        ):
            raise FORBIDDEN_EXCEPTION

    async def _read_bounded(self, *, file: UploadFile) -> bytes:
        max_raw_bytes = self.attachments_service.limits.max_raw_bytes
        data = bytearray()
        while len(data) <= max_raw_bytes:
            remaining = max_raw_bytes + 1 - len(data)
            chunk = await file.read(min(64 * 1024, remaining))
            if not chunk:
                return bytes(data)
            data.extend(chunk)
        raise AttachmentTooLarge(size=len(data), limit=max_raw_bytes)

    @intercept_exceptions()
    @_handle_attachment_exceptions()
    @handle_mount_exceptions()
    async def create_session_attachment(
        self,
        request: Request,
        *,
        session_id: str = Query(...),
    ) -> SessionAttachmentResponse:
        # Authorize first: the size limits below must not be probeable by an unauthorized caller.
        _validate_session_id_http(session_id)
        await self._check(request, Permission.EDIT_SESSIONS)

        # The Content-Length check must stay above `request.form()`: touching form data (or
        # declaring the file as a File(...) route param) spools the whole body to disk first.
        content_length = request.headers.get("content-length")
        if content_length is None:
            raise AttachmentLengthRequired()
        try:
            request_size = int(content_length)
        except ValueError as error:
            raise AttachmentRequestInvalid(
                "Content-Length must be an integer."
            ) from error

        max_request_bytes = (
            self.attachments_service.limits.max_raw_bytes
            + _ATTACHMENT_MULTIPART_OVERHEAD_BYTES
        )
        if request_size < 0:
            raise AttachmentRequestInvalid("Content-Length cannot be negative.")
        if request_size > max_request_bytes:
            raise AttachmentTooLarge(size=request_size, limit=max_request_bytes)

        form = await request.form()
        file = form.get("file")
        idempotency_key = form.get("idempotency_key")
        if not isinstance(file, UploadFile):
            raise AttachmentRequestInvalid("A file upload is required.")
        if not isinstance(idempotency_key, str):
            raise AttachmentRequestInvalid("An idempotency_key form field is required.")
        # The key is part of a composite btree index, which rejects oversized values at the DAO.
        if len(idempotency_key) > _MAX_IDEMPOTENCY_KEY_CHARACTERS:
            raise AttachmentRequestInvalid(
                f"idempotency_key must be at most {_MAX_IDEMPOTENCY_KEY_CHARACTERS} characters."
            )

        data = await self._read_bounded(file=file)
        attachment = await self.attachments_service.create_attachment(
            project_id=UUID(str(request.state.project_id)),
            user_id=UUID(str(request.state.user_id)),
            session_id=session_id,
            idempotency_key=idempotency_key,
            filename=file.filename,
            declared_media_type=file.content_type,
            data=data,
        )
        return SessionAttachmentResponse(
            count=1,
            attachment=_to_session_attachment(attachment),
        )

    @intercept_exceptions()
    @_handle_attachment_exceptions()
    @handle_mount_exceptions()
    async def download_session_attachment_content(
        self,
        request: Request,
        attachment_id: UUID,
        *,
        session_id: str = Query(...),
    ) -> Response:
        _validate_session_id_http(session_id)
        await self._check(request, Permission.VIEW_SESSIONS)

        content = await self.attachments_service.fetch_attachment_content(
            project_id=UUID(str(request.state.project_id)),
            session_id=session_id,
            attachment_id=attachment_id,
        )
        return Response(
            content=content.data,
            media_type=content.attachment.media_type,
            headers={
                "Content-Disposition": _content_disposition_attachment(
                    content.attachment.filename
                ),
                "X-Content-Type-Options": "nosniff",
            },
        )

    @intercept_exceptions()
    @_handle_attachment_exceptions()
    async def reference_session_attachments(
        self,
        request: Request,
        *,
        body: SessionAttachmentReferenceRequest,
    ) -> SessionAttachmentsResponse:
        _validate_session_id_http(body.session_id)
        await self._check(request, Permission.RUN_SESSIONS)

        attachments = await self.attachments_service.reference_attachments(
            project_id=UUID(str(request.state.project_id)),
            session_id=body.session_id,
            attachment_ids=body.attachment_ids,
        )
        return SessionAttachmentsResponse(
            count=len(attachments),
            attachments=[
                _to_session_attachment(attachment) for attachment in attachments
            ],
        )


class SessionMountsRouter:
    """Session-scoped view over mounts — /sessions/mounts/*.

    Thin: delegates to ``SessionMountsService`` (itself a wrapper over the
    full mounts domain). No mounts logic or storage lives here.
    """

    def __init__(
        self,
        *,
        session_mounts_service: SessionMountsService,
        mounts_service: MountsService,
    ) -> None:
        self.session_mounts_service = session_mounts_service
        self.mounts_service = mounts_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/mounts/",
            self.fetch_session_mounts,
            methods=["GET"],
            operation_id="fetch_session_mounts",
            response_model=SessionMountsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/mounts/query",
            self.query_session_mounts,
            methods=["POST"],
            operation_id="query_session_mounts",
            response_model=SessionMountsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/mounts/sign",
            self.sign_session_mount_credentials,
            methods=["POST"],
            operation_id="sign_session_mount_credentials",
            response_model=MountCredentialsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/mounts/{mount_id}/files/upload",
            self.upload_session_mount_file,
            methods=["POST"],
            operation_id="upload_session_mount_file",
            response_model=MountFileWrittenResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/mounts/{mount_id}/files/download",
            self.download_session_mount_file,
            methods=["GET"],
            operation_id="download_session_mount_file",
            response_model=None,
            response_class=Response,
            responses=BINARY_RESPONSE,
            status_code=status.HTTP_200_OK,
        )

    async def _check(self, request: Request, *permissions: Permission) -> None:
        # Session mounts sit in both domains: the caller needs the session AND mounts permission.
        for permission in permissions:
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=permission,
            ):
                raise FORBIDDEN_EXCEPTION

    @intercept_exceptions()
    async def fetch_session_mounts(
        self,
        request: Request,
        *,
        session_id: str = Query(...),
        include_archived: bool = Query(default=False),
    ) -> SessionMountsResponse:
        await self._check(request, Permission.VIEW_SESSIONS, Permission.VIEW_MOUNTS)

        mounts = await self.session_mounts_service.query_mounts(
            project_id=UUID(request.state.project_id),
            mount_query=SessionMountQuery(
                session_id=session_id,
                include_archived=include_archived,
            ),
            windowing=None,
        )

        return SessionMountsResponse(count=len(mounts), mounts=mounts)

    @intercept_exceptions()
    async def query_session_mounts(
        self,
        request: Request,
        *,
        body: SessionMountQueryRequest,
        session_id: Optional[str] = Query(default=None),
        include_archived: bool = Query(default=False),
    ) -> SessionMountsResponse:
        await self._check(request, Permission.VIEW_SESSIONS, Permission.VIEW_MOUNTS)

        # session_id is required for the session-scoped view; query param wins, then body.
        resolved_session_id = session_id or (
            body.mount.session_id if body.mount else None
        )
        if not resolved_session_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="session_id is required for a session-scoped mounts query.",
            )

        mount_query = SessionMountQuery(
            session_id=resolved_session_id,
            include_archived=(
                include_archived
                or (body.mount.include_archived if body.mount else False)
            ),
        )

        mounts = await self.session_mounts_service.query_mounts(
            project_id=UUID(request.state.project_id),
            mount_query=mount_query,
            windowing=body.windowing,
        )

        return SessionMountsResponse(count=len(mounts), mounts=mounts)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def sign_session_mount_credentials(
        self,
        request: Request,
        *,
        session_id: str = Query(...),
        name: str = Query(
            default="cwd",
            description=(
                "Which session-scoped mount to sign, e.g. 'cwd' (default) or a "
                "per-harness transcript dir mount (e.g. 'claude-projects', "
                "'pi-sessions'). Each name is its own mount row / durable prefix."
            ),
        ),
    ) -> MountCredentialsResponse:
        _validate_session_id_http(session_id)

        await self._check(request, Permission.RUN_SESSIONS, Permission.USE_MOUNTS)

        mount = await self.mounts_service.get_or_create_session_mount(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            session_id=session_id,
            name=name,
        )

        credentials = await sign_mount_credentials(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mount_id=mount.id,
        )
        return MountCredentialsResponse(count=1, mount=mount, credentials=credentials)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def upload_session_mount_file(
        self,
        request: Request,
        mount_id: UUID,
        *,
        file: FastAPIUploadFile,
        path: Optional[str] = Query(default=None),
    ) -> MountFileWrittenResponse:
        await self._check(request, Permission.EDIT_SESSIONS, Permission.EDIT_MOUNTS)

        written = await upload_mount_file(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            file=file,
            path=path,
        )
        return MountFileWrittenResponse(path=written.path, size=written.size)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def download_session_mount_file(
        self,
        request: Request,
        mount_id: UUID,
        *,
        path: str = Query(...),
    ):
        await self._check(request, Permission.VIEW_SESSIONS, Permission.VIEW_MOUNTS)

        return await download_mount_file(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
        )


class SessionTurnsRouter:
    """Turns sub-router — /sessions/turns/*"""

    def __init__(self, *, turns_service: SessionTurnsService) -> None:
        self.turns_service = turns_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.append_turn,
            methods=["POST"],
            operation_id="append_turn",
            status_code=status.HTTP_200_OK,
            response_model=SessionTurnResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/complete",
            self.complete_turn,
            methods=["POST"],
            operation_id="complete_turn",
            status_code=status.HTTP_200_OK,
            response_model=SessionTurnResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/query",
            self.query_turns,
            methods=["POST"],
            operation_id="query_turns",
            status_code=status.HTTP_200_OK,
            response_model=SessionTurnsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{turn_id}",
            self.fetch_turn,
            methods=["GET"],
            operation_id="fetch_turn",
            status_code=status.HTTP_200_OK,
            response_model=SessionTurnResponse,
            response_model_exclude_none=True,
        )

    @intercept_exceptions()
    async def append_turn(
        self,
        request: Request,
        body: SessionTurnAppendRequest,
    ) -> SessionTurnResponse:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        turn = await self.turns_service.append_turn(
            project_id=project_id,
            user_id=user_id,
            turn=SessionTurnCreate(
                session_id=body.session_id,
                turn_id=body.turn_id,
                stream_id=body.stream_id,
                turn_index=body.turn_index,
                harness_kind=body.harness_kind,
                agent_session_id=body.agent_session_id,
                sandbox_id=body.sandbox_id,
                references=body.references,
                trace_id=body.trace_id,
                span_id=body.span_id,
                start_time=body.start_time,
                end_time=body.end_time,
            ),
        )
        return SessionTurnResponse(count=1, turn=turn)

    @intercept_exceptions()
    async def complete_turn(
        self,
        request: Request,
        body: SessionTurnCompleteRequest,
    ) -> SessionTurnResponse:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        try:
            turn = await self.turns_service.complete_turn(
                project_id=project_id,
                turn=SessionTurnComplete(
                    session_id=body.session_id,
                    turn_index=body.turn_index,
                    agent_session_id=body.agent_session_id,
                    end_time=body.end_time,
                ),
            )
        except SessionTurnNotFound as e:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=e.message,
            ) from e
        return SessionTurnResponse(count=1, turn=turn)

    @intercept_exceptions()
    async def query_turns(
        self,
        request: Request,
        body: SessionTurnQueryRequest,
    ) -> SessionTurnsResponse:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        turns = await self.turns_service.query_turns(
            project_id=project_id,
            query=body.query,
            windowing=body.windowing,
        )
        return SessionTurnsResponse(count=len(turns), turns=turns)

    @intercept_exceptions()
    async def fetch_turn(
        self,
        request: Request,
        turn_id: UUID,
    ) -> SessionTurnResponse:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        turn = await self.turns_service.fetch_turn(
            project_id=project_id,
            turn_id=turn_id,
        )
        return SessionTurnResponse(count=1 if turn else 0, turn=turn)


class SessionsRootRouter:
    """Root session-level operations — /sessions/query, /sessions/ (DELETE),
    /sessions/archive, /sessions/unarchive.

    Orchestrates across facets via `SessionsService`, anchored on `session_id`
    (never `stream_id`). RBAC: VIEW_SESSIONS for query, EDIT_SESSIONS for the
    three mutations.
    """

    def __init__(
        self,
        *,
        sessions_service: SessionsService,
        streams_service: Optional[SessionStreamsService] = None,
        records_service: Optional[RecordsService] = None,
        interactions_service: Optional[SessionInteractionsService] = None,
        turns_service: Optional[SessionTurnsService] = None,
        inputs_service: Optional[SessionInputsService] = None,
    ) -> None:
        self.sessions_service = sessions_service
        self.streams_service = streams_service
        self.records_service = records_service
        self.interactions_service = interactions_service
        self.turns_service = turns_service
        self.inputs_service = inputs_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/sessions/query",
            self.query_sessions,
            methods=["POST"],
            operation_id="query_sessions",
            status_code=status.HTTP_200_OK,
            response_model=SessionsResponse,
            response_model_exclude_none=True,
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/",
            self.delete_session,
            methods=["DELETE"],
            operation_id="delete_session",
            status_code=status.HTTP_200_OK,
            tags=["Sessions"],
        )
        if inputs_service is not None:
            # The snapshot itself is `get_session_snapshot`, registered below: one route serves
            # both the reconnect watermark and the durable queue.
            self.router.add_api_route(
                "/sessions/{session_id}/inputs/{input_id}",
                self.remove_pending_input,
                methods=["DELETE"],
                operation_id="remove_pending_session_input",
                response_model=PendingInputResponse,
                tags=["Sessions"],
            )
        self.router.add_api_route(
            "/sessions/archive",
            self.archive_session,
            methods=["POST"],
            operation_id="archive_session",
            status_code=status.HTTP_200_OK,
            response_model=SessionResponse,
            response_model_exclude_none=True,
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/unarchive",
            self.unarchive_session,
            methods=["POST"],
            operation_id="unarchive_session",
            status_code=status.HTTP_200_OK,
            response_model=SessionResponse,
            response_model_exclude_none=True,
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/{session_id}",
            self.get_session_snapshot,
            methods=["GET"],
            operation_id="get_session_snapshot",
            status_code=status.HTTP_200_OK,
            response_model=SessionSnapshotResponse,
            response_model_exclude_none=True,
            tags=["Sessions"],
        )

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def get_session_snapshot(
        self,
        request: Request,
        session_id: str,
    ) -> SessionSnapshotResponse:
        _validate_session_id_http(session_id)
        if not await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(request.state.project_id),
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION
        if self.streams_service is None or self.interactions_service is None:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        if env.sessions.shared_reader and (
            self.records_service is None or self.turns_service is None
        ):
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        project_id = UUID(str(request.state.project_id))
        stream = await self.streams_service.fetch(
            project_id=project_id,
            session_id=session_id,
        )
        session = None
        execution = None
        read = None
        if env.sessions.shared_reader and stream is not None:
            session = sanitize_session_stream(stream)
            read = await self.records_service.get_read_state(
                project_id=project_id,
                session_id=session_id,
            )
            if getattr(stream, "history_incomplete", False):
                read = read.model_copy(update={"history_complete": False})
            execution = await self.turns_service.latest_turn(
                project_id=project_id,
                session_id=session_id,
            )
        interactions = await self.interactions_service.query_interactions(
            project_id=project_id,
            query=SessionInteractionQuery(
                session_id=session_id,
                status=SessionInteractionStatus.pending,
            ),
        )
        # The durable queue half. It is optional: a deployment without the inputs service still
        # gets the reconnect half, and reports an empty queue rather than failing the snapshot.
        inputs = (
            await self.inputs_service.list_pending(
                project_id=project_id,
                session_id=session_id,
            )
            if self.inputs_service is not None
            else []
        )
        # The stream remains the lifecycle source even when its reconnect representation is hidden.
        execution_state = SessionExecutionSnapshot(
            id=(stream.stopping_turn_id or stream.turn_id) if stream else None,
            state=(
                "stopping"
                if stream and stream.stopping_turn_id
                else "running"
                if stream and stream.flags.is_running
                else "idle"
            ),
        )
        return SessionSnapshotResponse(
            session=session,
            execution=execution,
            execution_state=execution_state,
            pending=SessionSnapshotPending(inputs=inputs, interactions=interactions),
            read=read,
            capabilities=_session_capabilities(),
        )

    @intercept_exceptions()
    async def query_sessions(
        self,
        request: Request,
        body: SessionQueryRequest,
    ) -> SessionsResponse:
        project_id = request.state.project_id
        user_id = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        if SessionExpansion.trigger in body.expand and not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_TRIGGERS,
        ):
            # Every other trigger read gates on VIEW_TRIGGERS; this one only checked
            # VIEW_SESSIONS, so a custom role with the former but not the latter could
            # read trigger names through the expansion (P2-3). Degrade rather than 403 —
            # drop the expansion so `trigger.name` comes back None like an unrequested
            # expansion, and the rest of the row still renders.
            body = body.model_copy(
                update={
                    "expand": [
                        expansion
                        for expansion in body.expand
                        if expansion != SessionExpansion.trigger
                    ]
                }
            )

        normalized = normalize_session_query_request(body)
        page = await self.sessions_service.query_sessions_page(
            project_id=UUID(str(project_id)),
            query=normalized.predicates,
            lifecycle=normalized.lifecycle,
            options=normalized.options,
            windowing=normalized.windowing,
        )
        response_windowing = compute_session_response_windowing(
            sessions=page.sessions,
            requested=normalized.windowing,
        )
        sessions = [sanitize_session_stream(session) for session in page.sessions]
        return SessionsResponse(
            count=len(page.sessions),
            total=page.total,
            sessions=sessions,
            windowing=response_windowing,
        )

    @intercept_exceptions()
    async def remove_pending_input(
        self, request: Request, session_id: str, input_id: UUID
    ) -> PendingInputResponse:
        _validate_session_id_http(session_id)
        project_id = UUID(str(request.state.project_id))
        user_id = request.state.user_id
        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION
        try:
            item = await self.inputs_service.remove(
                project_id=project_id,
                user_id=UUID(str(user_id)) if user_id else None,
                session_id=session_id,
                input_id=input_id,
            )
        except SessionInputNotFound as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "pending_input_not_found",
                    "message": str(error),
                    "retryable": False,
                    "details": {"input_id": error.input_id},
                },
            ) from error
        except SessionInputNotRemovable as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "pending_input_promoted",
                    "message": str(error),
                    "retryable": False,
                    "details": {"input_id": error.input_id},
                },
            ) from error
        return PendingInputResponse(input=item)

    @intercept_exceptions()
    async def delete_session(
        self,
        request: Request,
        session_id: str = Query(...),
    ) -> dict:
        _validate_session_id_http(session_id)
        project_id = request.state.project_id
        user_id = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.EDIT_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        await self.sessions_service.delete_session(
            project_id=UUID(str(project_id)),
            user_id=UUID(str(user_id)),
            session_id=session_id,
        )
        return {"ok": True}

    @intercept_exceptions()
    async def archive_session(
        self,
        request: Request,
        session_id: str = Query(...),
    ) -> SessionResponse:
        _validate_session_id_http(session_id)
        project_id = request.state.project_id
        user_id = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.EDIT_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        session = await self.sessions_service.archive_session(
            project_id=UUID(str(project_id)),
            user_id=UUID(str(user_id)),
            session_id=session_id,
        )
        return SessionResponse(
            count=1 if session else 0,
            session=sanitize_session_stream(session),
        )

    @intercept_exceptions()
    async def unarchive_session(
        self,
        request: Request,
        session_id: str = Query(...),
    ) -> SessionResponse:
        _validate_session_id_http(session_id)
        project_id = request.state.project_id
        user_id = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.EDIT_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        session = await self.sessions_service.unarchive_session(
            project_id=UUID(str(project_id)),
            user_id=UUID(str(user_id)),
            session_id=session_id,
        )
        return SessionResponse(
            count=1 if session else 0,
            session=sanitize_session_stream(session),
        )


# ---------------------------------------------------------------------------
# Session control — durable commands (Stop)
# ---------------------------------------------------------------------------


def _handle_command_exceptions():
    """Map the commands plane's domain errors onto status codes.

    A separate decorator from `_handle_session_exceptions` so the two planes' error vocabularies
    stay apart: a conflict here means "the execution you named is not the one running", which is
    a different thing from the streams plane's "this session is already busy".
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except SessionIdInvalid as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=e.message,
                ) from e
            except ExecutionExpectationFailed as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "message": e.message,
                        "current_execution_id": e.current,
                    },
                ) from e
            except SessionCommandIdempotencyConflict as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=e.message,
                ) from e
            except SessionCommandNotFound as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=e.message,
                ) from e
            except SessionCommandNotClaimable as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"message": e.message, "state": e.state},
                ) from e
            except InteractionResponseConflict as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": e.code,
                        "message": e.message,
                        "retryable": False,
                        **({"details": e.details} if e.details else {}),
                    },
                ) from e

        return wrapper

    return decorator


def _handle_input_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except SessionInputBusy as error:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "session_busy",
                        "message": str(error),
                        "retryable": True,
                        "next_step": "Retry after the current execution settles.",
                        "details": {"current_execution_id": error.current_execution_id},
                    },
                ) from error
            except SessionInputIdempotencyConflict as error:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "idempotency_key_reused",
                        "message": str(error),
                        "retryable": False,
                        "next_step": "Reuse the original body or send a new key.",
                    },
                ) from error
            except ValueError as error:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "code": "validation_error",
                        "message": str(error),
                        "retryable": False,
                    },
                ) from error

        return wrapper

    return decorator


class SessionControlRouter:
    """The Stop plane: one public route and one internal one.

    `POST /sessions/{session_id}/cancel` is the product's Stop. It is deliberately NOT behind
    the runner concurrency limit: refusing to STOP work because a project is at its run limit
    would be the exact wrong answer to a busy project.

    `POST /sessions/control/commands/{command_id}/outcome` is how the runner reports what
    happened. It authenticates with the shared runner token rather than a project credential,
    because the runner holds no project credential of its own for a command it was handed. The
    command id resolves the project, so a caller still cannot reach across tenants: it can only
    settle a command whose id it already knows and that it currently holds the claim on.
    """

    def __init__(
        self,
        *,
        commands_service: SessionCommandsService,
        inputs_service: Optional[SessionInputsService] = None,
    ) -> None:
        self._service = commands_service
        self._inputs_service = inputs_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/sessions/{session_id}/cancel",
            self.cancel_session_execution,
            methods=["POST"],
            operation_id="cancel_session_execution",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/{session_id}/continuations/resume",
            self.resume_session_continuation,
            methods=["POST"],
            operation_id="resume_session_continuation",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/control/commands/{command_id}/outcome",
            self.report_command_outcome,
            methods=["POST"],
            operation_id="report_session_command_outcome",
            tags=["Sessions"],
            include_in_schema=False,
        )
        if inputs_service is not None:
            self.router.add_api_route(
                "/sessions/control/inputs/admit",
                self.admit_session_input,
                methods=["POST"],
                operation_id="admit_session_input",
                include_in_schema=False,
                tags=["Sessions"],
            )

    @intercept_exceptions()
    @_handle_input_exceptions()
    async def admit_session_input(
        self, request: Request, payload: PendingInputAdmissionRequest
    ) -> JSONResponse:
        project_id = UUID(str(request.state.project_id))
        user_id = request.state.user_id
        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION
        idempotency_key = request.headers.get("Idempotency-Key")
        if idempotency_key is not None:
            idempotency_key = (
                idempotency_key.strip()[:_MAX_IDEMPOTENCY_KEY_CHARACTERS] or None
            )
        admission = await self._inputs_service.admit(
            project_id=project_id,
            user_id=UUID(str(user_id)) if user_id else None,
            session_id=payload.session_id,
            content=payload.content,
            policy=payload.on_busy,
            idempotency_key=idempotency_key,
        )
        if (
            payload.on_busy == "steer"
            and admission.action == "pending"
            and admission.input is not None
            and admission.input.state == PendingInputState.pending
        ):
            # The input is durable before Stop is requested. A refused or unreachable Stop
            # therefore never loses the user's message; it stays visible and removable.
            try:
                await self._service.request_cancel(
                    project_id=project_id,
                    user_id=UUID(str(user_id)) if user_id else None,
                    session_id=payload.session_id,
                    expected_execution_id=admission.execution_id,
                    idempotency_key=f"steer:{admission.input.id}",
                    steer_input_id=admission.input.id,
                )
            except Exception as error:  # noqa: BLE001 - the input is already durable
                log.warning(
                    "steer stop request failed input=%s session=%s: %s",
                    admission.input.id,
                    payload.session_id,
                    error,
                )
        response = PendingInputAdmissionResponse(**admission.model_dump())
        return JSONResponse(
            status_code=(
                status.HTTP_202_ACCEPTED
                if admission.action == "pending"
                else status.HTTP_200_OK
            ),
            content=response.model_dump(mode="json", exclude_none=True),
        )

    @intercept_exceptions()
    @_handle_command_exceptions()
    async def cancel_session_execution(
        self,
        request: Request,
        session_id: str,
        payload: Optional[SessionCancelRequest] = None,
    ) -> JSONResponse:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        if not env.agenta.sessions.durable_stop:
            legacy = await self._service.request_cancel_legacy(
                project_id=UUID(str(project_id)),
                user_id=UUID(str(user_id)),
                session_id=session_id,
                expected_execution_id=(
                    payload.expected_execution_id if payload else None
                ),
            )
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content=legacy.model_dump(mode="json"),
            )

        idempotency_key = request.headers.get("Idempotency-Key")
        if idempotency_key is not None:
            idempotency_key = idempotency_key.strip()
            if len(idempotency_key) > _MAX_IDEMPOTENCY_KEY_CHARACTERS:
                return _idempotency_key_too_long_response()
            idempotency_key = idempotency_key or None

        admission = await self._service.request_cancel(
            project_id=UUID(str(project_id)),
            user_id=UUID(str(user_id)) if user_id else None,
            session_id=session_id,
            expected_execution_id=payload.expected_execution_id if payload else None,
            idempotency_key=idempotency_key,
        )

        body = SessionCancelResponse(
            command=SessionCommandRef(
                id=admission.command.id,
                state=admission.command.state.value,
            ),
            execution=SessionExecutionRef(
                id=admission.execution_id,
                state="stopping" if admission.accepted else "idle",
            ),
        )
        # 202 and not 200 for the accepted case: the work is not done when the response
        # returns. The caller learns the outcome from the session's own state.
        return JSONResponse(
            status_code=(
                status.HTTP_202_ACCEPTED if admission.accepted else status.HTTP_200_OK
            ),
            content=body.model_dump(mode="json"),
        )

    @intercept_exceptions()
    @_handle_command_exceptions()
    async def resume_session_continuation(
        self,
        request: Request,
        session_id: str,
    ) -> SessionContinuationResumeResponse:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        resumed = False
        if env.agenta.sessions.durable_approvals:
            resumed = bool(
                await self._service.resume_recoverable_continuation(
                    project_id=UUID(str(project_id)),
                    session_id=session_id,
                )
            )
        return SessionContinuationResumeResponse(resumed=resumed)

    @intercept_exceptions()
    @_handle_command_exceptions()
    async def report_command_outcome(
        self,
        request: Request,
        command_id: UUID,
        payload: SessionControlOutcomeRequest,
    ) -> SessionControlOutcomeResponse:
        _assert_runner_token(request)

        report = await self._service.report_outcome(
            command_id=command_id,
            replica_id=payload.replica_id,
            result=payload.result,
            execution_id=payload.execution.id,
            execution_state=payload.execution.state,
            error=payload.execution.error,
        )
        return SessionControlOutcomeResponse(
            command=SessionCommandSettlement(
                id=report.command.id,
                state=report.command.state.value,
                outcome=(
                    report.command.outcome.value if report.command.outcome else "failed"
                ),
                settled_at=report.command.settled_at,
            ),
            admitted=report.admitted,
        )


def _assert_runner_token(request: Request) -> None:
    """The runner proves it is the platform runtime with the shared secret both sides hold.

    Constant-time compare, so a wrong token leaks no length or prefix through timing. A missing
    configured token fails closed: an unset secret must never mean "let everyone in".
    """
    expected = env.runner.token
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="runner token is not configured on this deployment",
        )
    presented = request.headers.get("X-Agenta-Runner-Token") or ""
    if not presented:
        authorization = request.headers.get("Authorization") or ""
        if authorization.lower().startswith("bearer "):
            presented = authorization[7:].strip()
    if not compare_digest(presented.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )


# ---------------------------------------------------------------------------
# Top-level composer
# ---------------------------------------------------------------------------


class SessionsRouter:
    """Composes all session sub-domain routers into one object.

    The entrypoint mounts:
      sessions_router.streams.router               → no prefix (paths include /sessions/streams/…)
      sessions_router.records.router               → prefix /sessions/records
      sessions_router.interactions.router          → prefix /sessions/interactions
      sessions_router.attachments.router           → prefix /sessions
      sessions_router.mounts.router                → prefix /sessions
      sessions_router.turns.router                 → prefix /sessions/turns
      sessions_router.root.router                  → no prefix (paths include /sessions/query, /sessions/, /sessions/archive, /sessions/unarchive)
      sessions_router.control.router               → no prefix (paths include /sessions/{session_id}/cancel and /sessions/control/…)

    `control` MUST be mounted AFTER `root`. `/sessions/{session_id}/cancel` is a two-segment
    path and `/sessions/query` is one, so they cannot actually collide — but mounting the
    literal routes first keeps that true for any two-segment literal added later.
    """

    def __init__(
        self,
        *,
        streams_service: SessionStreamsService,
        records_service: RecordsService,
        interactions_service: SessionInteractionsService,
        workflows_service: WorkflowsService,
        attachments_service: SessionAttachmentsService,
        session_mounts_service: SessionMountsService,
        mounts_service: MountsService,
        turns_service: SessionTurnsService,
        sessions_service: SessionsService,
        commands_service: SessionCommandsService,
        inputs_service: Optional[SessionInputsService] = None,
        respond_task: Optional[Any] = None,
        interactions_dispatcher: Optional[Any] = None,
    ) -> None:
        self.streams = SessionStreamsRouter(
            service=streams_service,
            interactions_service=interactions_service,
            records_service=records_service,
        )
        self.records = RecordsRouter(
            records_service=records_service,
            commands_service=commands_service,
        )
        self.interactions = InteractionsRouter(
            interactions_service=interactions_service,
            workflows_service=workflows_service,
            respond_task=respond_task,
            interactions_dispatcher=interactions_dispatcher,
            commands_service=commands_service,
            turns_service=turns_service,
            streams_service=streams_service,
        )
        self.attachments = SessionAttachmentsRouter(
            attachments_service=attachments_service,
        )
        self.mounts = SessionMountsRouter(
            session_mounts_service=session_mounts_service,
            mounts_service=mounts_service,
        )
        self.turns = SessionTurnsRouter(turns_service=turns_service)
        self.root = SessionsRootRouter(
            sessions_service=sessions_service,
            streams_service=streams_service,
            records_service=records_service,
            interactions_service=interactions_service,
            turns_service=turns_service,
            inputs_service=inputs_service,
        )
        self.control = SessionControlRouter(
            commands_service=commands_service, inputs_service=inputs_service
        )
